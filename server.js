/**
 * Éco-Péage — Serveur web + API REST (Node.js sans dépendance).
 *
 * Lancement : `node server.js` (ou `npm start`) puis http://localhost:3000
 *
 * Les fichiers data/reseau.json et data/tarifs.json sont relus dès qu'ils
 * changent sur le disque : mettre à jour les tarifs ne demande aucun
 * redémarrage.
 *
 * Endpoints :
 *   GET /api/gares                     Liste des gares de péage
 *   GET /api/autoroutes                Liste des autoroutes couvertes
 *   GET /api/tarifs                    Métadonnées de la grille tarifaire
 *   GET /api/bornes                    Bornes de recharge rapide par gare
 *   GET /api/trajet?depart=&arrivee=   Calcul du trajet (+ &sorties=1..5,
 *                                      &recharge=1 pour les bornes électriques)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const moteur = require('./js/moteur.js');

const PORT = process.env.PORT || 3000;
const RACINE = __dirname;

/* --- Cache des données, invalidé quand le fichier change (mtime) --------- */

const cache = {};

function chargerJson(fichier) {
  const chemin = path.join(RACINE, 'data', fichier);
  const mtime = fs.statSync(chemin).mtimeMs;
  if (!cache[fichier] || cache[fichier].mtime !== mtime) {
    cache[fichier] = { mtime, contenu: JSON.parse(fs.readFileSync(chemin, 'utf8')) };
  }
  return cache[fichier].contenu;
}

/* --- Réponses ------------------------------------------------------------ */

function repondreJson(res, statut, corps) {
  const json = JSON.stringify(corps);
  res.writeHead(statut, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function servirFichier(res, cheminRelatif) {
  const chemin = path.normalize(path.join(RACINE, cheminRelatif));
  if (!chemin.startsWith(RACINE)) {
    return repondreJson(res, 403, { erreur: 'Accès refusé' });
  }
  fs.readFile(chemin, (err, contenu) => {
    if (err) return repondreJson(res, 404, { erreur: 'Fichier introuvable' });
    res.writeHead(200, { 'Content-Type': TYPES_MIME[path.extname(chemin)] || 'application/octet-stream' });
    res.end(contenu);
  });
}

/* --- Routage API ---------------------------------------------------------- */

function traiterApi(url, res) {
  const reseau = chargerJson('reseau.json');
  const tarifs = chargerJson('tarifs.json');

  switch (url.pathname) {
    case '/api/gares':
      return repondreJson(res, 200, { gares: moteur.listerGares(reseau) });

    case '/api/autoroutes':
      return repondreJson(res, 200, {
        autoroutes: reseau.autoroutes.map((a) => ({
          code: a.code,
          nom: a.nom,
          nbGares: a.gares.length
        }))
      });

    case '/api/tarifs':
      return repondreJson(res, 200, {
        derniereMiseAJour: tarifs.derniereMiseAJour,
        classeVehicule: tarifs.classeVehicule,
        tauxParKm: tarifs.tauxParKm
      });

    case '/api/bornes':
      return repondreJson(res, 200, chargerJson('bornes.json'));

    case '/api/trajet': {
      const depart = url.searchParams.get('depart');
      const arrivee = url.searchParams.get('arrivee');
      if (!depart || !arrivee) {
        return repondreJson(res, 400, { erreur: 'Paramètres requis : depart et arrivee (identifiants de gares)' });
      }
      const maxSorties = Math.min(5, Math.max(1, parseInt(url.searchParams.get('sorties'), 10) || 5));
      const resultat = moteur.calculerTrajet(reseau, tarifs, depart, arrivee, maxSorties);
      if (url.searchParams.get('recharge') === '1') {
        moteur.attacherBornes(resultat, chargerJson('bornes.json'));
      }
      return repondreJson(res, resultat.erreur ? 404 : 200, resultat);
    }

    default:
      return repondreJson(res, 404, { erreur: 'Endpoint inconnu' });
  }
}

/* --- Serveur -------------------------------------------------------------- */

const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      return traiterApi(url, res);
    } catch (err) {
      return repondreJson(res, 500, { erreur: 'Erreur interne : ' + err.message });
    }
  }

  const chemin = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  return servirFichier(res, chemin);
});

serveur.listen(PORT, () => {
  console.log(`Éco-Péage démarré : http://localhost:${PORT}`);
  console.log(`API REST          : http://localhost:${PORT}/api/gares`);
});
