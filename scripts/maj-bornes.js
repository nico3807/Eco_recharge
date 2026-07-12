#!/usr/bin/env node
/**
 * Mise à jour des bornes de recharge électrique rapide — data/bornes.json
 *
 * Pour chaque gare de péage du réseau (data/reseau.json), ce script interroge
 * le portail open data data.smartidf.services (jeu de données OSM
 * « Stations de recharge pour véhicule électrique - France ») et retient les
 * bornes de recharge RAPIDE situées à moins de RAYON_METRES de la gare.
 *
 * Usage :  node scripts/maj-bornes.js
 *
 * À lancer régulièrement (cron, action GitHub…) pour rafraîchir les données,
 * au même titre que data/tarifs.json. Le serveur relit le fichier
 * automatiquement, sans redémarrage.
 *
 * Aucune dépendance : Node.js ≥ 18 (fetch natif).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PORTAIL = 'https://data.smartidf.services';
const RECHERCHE_JEU = 'stations de recharge véhicule électrique france OSM';
const RAYON_METRES = 1000;      // bornes à moins de 1 km de la sortie
const PUISSANCE_MIN_KW = 50;    // seuil « recharge rapide »
const PAUSE_MS = 250;           // politesse entre deux requêtes

const CHEMIN_RESEAU = path.join(__dirname, '..', 'data', 'reseau.json');
const CHEMIN_BORNES = path.join(__dirname, '..', 'data', 'bornes.json');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function lireJson(url) {
  const reponse = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status} — ${url}`);
  return reponse.json();
}

/**
 * Retrouve l'identifiant exact du jeu de données sur le portail (le slug peut
 * évoluer, on passe donc par la recherche du catalogue).
 */
async function trouverJeuDeDonnees() {
  const url = `${PORTAIL}/api/explore/v2.1/catalog/datasets?limit=10&where=${encodeURIComponent(
    `search("${RECHERCHE_JEU}")`
  )}`;
  const catalogue = await lireJson(url);
  const resultats = catalogue.results || [];
  const osm = resultats.find((d) => /osm/i.test(JSON.stringify(d.metas || d))) || resultats[0];
  if (!osm) throw new Error('Jeu de données introuvable sur ' + PORTAIL);
  return osm.dataset_id;
}

/** Extrait la puissance maximale (kW) d'un enregistrement OSM, si présente. */
function puissanceKw(champs) {
  const brut = [];
  for (const [cle, valeur] of Object.entries(champs)) {
    if (/output|power|puissance/i.test(cle) && valeur) brut.push(String(valeur));
  }
  let max = null;
  brut.join(' ').replace(/(\d+(?:[.,]\d+)?)\s*k/gi, (_, n) => {
    const kw = parseFloat(n.replace(',', '.'));
    if (max === null || kw > max) max = kw;
    return _;
  });
  return max;
}

/** Considère une borne comme « rapide » : puissance ≥ seuil, ou prise DC connue. */
function estRapide(champs) {
  const kw = puissanceKw(champs);
  if (kw !== null) return kw >= PUISSANCE_MIN_KW;
  const texte = JSON.stringify(champs).toLowerCase();
  return /chademo|combo|ccs|supercharger|ionity/.test(texte);
}

function nomBorne(champs) {
  return champs.name || champs.nom || champs.operator || champs.operateur ||
         champs.network || champs.brand || 'Station de recharge';
}

async function bornesAutourDe(datasetId, gare) {
  const where = `distance(geo_point_2d, geom'POINT(${gare.lon} ${gare.lat})', ${RAYON_METRES}m)`;
  const url = `${PORTAIL}/api/explore/v2.1/catalog/datasets/${datasetId}/records` +
              `?limit=20&where=${encodeURIComponent(where)}`;
  const donnees = await lireJson(url);
  return (donnees.results || [])
    .map((enregistrement) => {
      const champs = enregistrement.fields || enregistrement;
      const geo = champs.geo_point_2d || champs.geopoint || {};
      const lat = geo.lat !== undefined ? geo.lat : (Array.isArray(geo) ? geo[0] : null);
      const lon = geo.lon !== undefined ? geo.lon : (Array.isArray(geo) ? geo[1] : null);
      return {
        nom: nomBorne(champs),
        operateur: champs.operator || champs.operateur || champs.network || null,
        puissanceKw: puissanceKw(champs),
        distanceM: lat !== null ? Math.round(distanceMetres(gare.lat, gare.lon, lat, lon)) : null,
        rapide: estRapide(champs)
      };
    })
    .filter((borne) => borne.rapide)
    .sort((a, b) => (a.distanceM || 9e9) - (b.distanceM || 9e9))
    .map(({ rapide, ...borne }) => borne);
}

/** Distance haversine en mètres. */
function distanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

(async () => {
  const reseau = JSON.parse(fs.readFileSync(CHEMIN_RESEAU, 'utf8'));
  console.log('Recherche du jeu de données sur', PORTAIL, '…');
  const datasetId = await trouverJeuDeDonnees();
  console.log('Jeu de données :', datasetId);

  const parGare = {};
  let total = 0;
  for (const autoroute of reseau.autoroutes) {
    for (const gare of autoroute.gares) {
      try {
        const bornes = await bornesAutourDe(datasetId, gare);
        if (bornes.length > 0) {
          parGare[gare.id] = bornes;
          total += bornes.length;
        }
        process.stdout.write(`  ${gare.id} : ${bornes.length} borne(s) rapide(s)\n`);
      } catch (erreur) {
        console.error(`  ${gare.id} : ÉCHEC — ${erreur.message}`);
      }
      await pause(PAUSE_MS);
    }
  }

  const sortie = {
    description: `Bornes de recharge électrique rapide (≥ ${PUISSANCE_MIN_KW} kW) à moins de ${RAYON_METRES} m des gares de péage.`,
    source: `${PORTAIL} — jeu de données « ${datasetId} » (données OSM)`,
    derniereMiseAJour: new Date().toISOString().slice(0, 10),
    rayonMetres: RAYON_METRES,
    puissanceMinKw: PUISSANCE_MIN_KW,
    parGare
  };
  fs.writeFileSync(CHEMIN_BORNES, JSON.stringify(sortie, null, 2) + '\n');
  console.log(`\nÉcrit ${CHEMIN_BORNES} — ${total} bornes sur ${Object.keys(parGare).length} gares.`);
})().catch((erreur) => {
  console.error('Échec de la mise à jour :', erreur.message);
  process.exit(1);
});
