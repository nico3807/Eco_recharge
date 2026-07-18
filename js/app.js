/**
 * Éco-Péage — Logique de l'interface.
 *
 * Le front interroge en priorité l'API REST (/api/...). Si le serveur n'est
 * pas disponible (page ouverte via un simple hébergement statique), il charge
 * les fichiers JSON de data/ et calcule les trajets dans le navigateur grâce
 * au moteur partagé js/moteur.js.
 */
(function () {
  'use strict';

  var champDepart = document.getElementById('gare-depart');
  var champArrivee = document.getElementById('gare-arrivee');
  var listeGares = document.getElementById('liste-gares');
  var formulaire = document.getElementById('formulaire-trajet');
  var boutonCalculer = document.getElementById('bouton-calculer');
  var boutonInverser = document.getElementById('bouton-inverser');
  var optionRecharge = document.getElementById('option-recharge');
  var messageErreur = document.getElementById('message-erreur');
  var metaTarifs = document.getElementById('meta-tarifs');

  var voile = document.getElementById('voile-popup');
  var boutonFermer = document.getElementById('bouton-fermer');
  var popupTrajet = document.getElementById('popup-trajet');
  var choixParcours = document.getElementById('choix-parcours');
  var listeParcours = document.getElementById('liste-parcours');
  var infoHorsAutoroute = document.getElementById('info-hors-autoroute');
  var prixDirect = document.getElementById('prix-direct');
  var tagsSorties = document.getElementById('tags-sorties');
  var detailSorties = document.getElementById('detail-sorties');
  var detailTitre = document.getElementById('detail-titre');
  var detailListe = document.getElementById('detail-liste');
  var bornesMeta = document.getElementById('bornes-meta');
  var popupNote = document.getElementById('popup-note');

  var voileCarte = document.getElementById('voile-carte');
  var boutonFermerCarte = document.getElementById('bouton-fermer-carte');
  var boutonCarteDirect = document.getElementById('bouton-carte-direct');
  var boutonCarteDetail = document.getElementById('bouton-carte-detail');
  var titreCarte = document.getElementById('titre-carte');
  var carteSousTitre = document.getElementById('carte-sous-titre');

  var voileWaze = document.getElementById('voile-waze');
  var boutonFermerWaze = document.getElementById('bouton-fermer-waze');
  var boutonWazeDirect = document.getElementById('bouton-waze-direct');
  var boutonWazeDetail = document.getElementById('bouton-waze-detail');
  var wazeSousTitre = document.getElementById('waze-sous-titre');
  var wazeEtapes = document.getElementById('waze-etapes');

  var gares = [];
  var modeLocal = false;   // true si l'API est indisponible (calcul navigateur)
  var donneesLocales = null;
  var resultatCourant = null;      // dernier résultat affiché dans la pop-up
  var metaBornesCourante = null;   // métadonnées bornes du dernier résultat
  var indexParcoursCourant = 0;    // parcours sélectionné dans la pop-up
  var alternativeCourante = null;  // solution (1-5 sorties) affichée en détail
  var carteLeaflet = null;         // instance Leaflet de la pop-up carte

  /* --- Utilitaires ------------------------------------------------------- */

  function formaterPrix(prix) {
    return prix.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function afficherErreur(texte) {
    messageErreur.textContent = texte;
    messageErreur.hidden = !texte;
  }

  function normaliser(texte) {
    return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  /** Retrouve une gare à partir du texte saisi (libellé exact ou nom approchant). */
  function trouverGare(saisie) {
    var cible = normaliser(saisie);
    if (!cible) return null;
    var exacte = gares.find(function (g) { return normaliser(g.libelle) === cible || normaliser(g.nom) === cible; });
    if (exacte) return exacte;
    var candidates = gares.filter(function (g) { return normaliser(g.libelle).indexOf(cible) !== -1; });
    return candidates.length === 1 ? candidates[0] : null;
  }

  /* --- Chargement des données (API puis repli local) ---------------------- */

  function chargerJson(url) {
    return fetch(url).then(function (reponse) {
      if (!reponse.ok) throw new Error('HTTP ' + reponse.status);
      return reponse.json();
    });
  }

  function initialiser() {
    chargerJson('/api/gares')
      .then(function (donnees) {
        gares = donnees.gares;
        return chargerJson('/api/tarifs');
      })
      .then(function (tarifs) {
        afficherMetaTarifs(tarifs.derniereMiseAJour, tarifs.classeVehicule);
        remplirDatalist();
      })
      .catch(function () {
        // API absente : calcul entièrement dans le navigateur
        modeLocal = true;
        Promise.all([chargerJson('data/reseau.json'), chargerJson('data/tarifs.json')])
          .then(function (resultats) {
            donneesLocales = { reseau: resultats[0], tarifs: resultats[1] };
            gares = MoteurEco.listerGares(donneesLocales.reseau);
            afficherMetaTarifs(donneesLocales.tarifs.derniereMiseAJour, donneesLocales.tarifs.classeVehicule);
            remplirDatalist();
          })
          .catch(function () {
            metaTarifs.textContent = 'Impossible de charger les données. Lancez le serveur : node server.js';
            afficherErreur('Données indisponibles. Démarrez le serveur avec « node server.js » puis rechargez la page.');
          });
      });
  }

  function afficherMetaTarifs(date, classe) {
    metaTarifs.textContent = 'Tarifs véhicule classe ' + classe +
      ' — dernière mise à jour : ' + new Date(date).toLocaleDateString('fr-FR') +
      (modeLocal ? ' (calcul local, API hors ligne)' : '');
  }

  function remplirDatalist() {
    listeGares.innerHTML = '';
    gares.forEach(function (gare) {
      var option = document.createElement('option');
      option.value = gare.libelle;
      listeGares.appendChild(option);
    });
  }

  /* --- Calcul du trajet ---------------------------------------------------- */

  function calculerTrajet(departId, arriveeId, avecRecharge) {
    if (modeLocal) {
      var resultat = MoteurEco.calculerTrajet(donneesLocales.reseau, donneesLocales.tarifs, departId, arriveeId, 5);
      if (resultat.erreur) return Promise.reject(new Error(resultat.erreur));
      if (!avecRecharge) return Promise.resolve(resultat);
      // Charge les bornes une seule fois puis annote le résultat localement
      var bornesPretes = donneesLocales.bornes
        ? Promise.resolve(donneesLocales.bornes)
        : chargerJson('data/bornes.json').then(function (bornes) {
            donneesLocales.bornes = bornes;
            return bornes;
          });
      return bornesPretes.then(function (bornes) {
        return MoteurEco.attacherBornes(resultat, bornes);
      });
    }
    return fetch('/api/trajet?depart=' + encodeURIComponent(departId) +
                 '&arrivee=' + encodeURIComponent(arriveeId) + '&sorties=5' +
                 (avecRecharge ? '&recharge=1' : ''))
      .then(function (reponse) {
        return reponse.json().then(function (corps) {
          if (!reponse.ok || corps.erreur) throw new Error(corps.erreur || 'Erreur serveur');
          return corps;
        });
      });
  }

  formulaire.addEventListener('submit', function (evenement) {
    evenement.preventDefault();
    afficherErreur('');

    var depart = trouverGare(champDepart.value);
    var arrivee = trouverGare(champArrivee.value);

    if (!depart) return afficherErreur("Gare d'entrée introuvable : choisissez une gare dans la liste proposée.");
    if (!arrivee) return afficherErreur('Gare de sortie introuvable : choisissez une gare dans la liste proposée.');
    if (depart.id === arrivee.id) return afficherErreur("Les gares d'entrée et de sortie doivent être différentes.");

    boutonCalculer.disabled = true;
    boutonCalculer.textContent = 'Calcul en cours…';

    calculerTrajet(depart.id, arrivee.id, optionRecharge.checked)
      .then(afficherResultat)
      .catch(function (erreur) { afficherErreur(erreur.message); })
      .finally(function () {
        boutonCalculer.disabled = false;
        boutonCalculer.textContent = 'Calculer le meilleur tarif';
      });
  });

  boutonInverser.addEventListener('click', function () {
    var tmp = champDepart.value;
    champDepart.value = champArrivee.value;
    champArrivee.value = tmp;
  });

  /* --- Pop-up de résultat --------------------------------------------------- */

  function afficherResultat(resultat) {
    resultatCourant = resultat;
    metaBornesCourante = resultat.bornesMeta || null;

    // Choix du parcours : proposé quand l'itinéraire le plus court comprend
    // une portion hors autoroute et qu'il existe des alternatives
    if (resultat.parcours.length > 1) {
      listeParcours.innerHTML = '';
      resultat.parcours.forEach(function (parcours, index) {
        listeParcours.appendChild(construireChoixParcours(parcours, index));
      });
      choixParcours.hidden = false;
    } else {
      choixParcours.hidden = true;
    }

    afficherParcours(0);

    voile.hidden = false;
    document.body.style.overflow = 'hidden';
    boutonFermer.focus();
  }

  /** Une option (bouton radio) du choix de parcours. */
  function construireChoixParcours(parcours, index) {
    var etiquette = document.createElement('label');
    etiquette.className = 'parcours';

    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'parcours';
    radio.value = String(index);
    radio.checked = index === 0;
    radio.addEventListener('change', function () {
      if (radio.checked) afficherParcours(index);
    });

    var texte = document.createElement('span');
    texte.className = 'parcours-texte';

    var titre = document.createElement('strong');
    titre.textContent = 'Parcours ' + (index + 1) + ' — ' + parcours.description +
      ' · ' + parcours.distanceKm + ' km · direct ' + formaterPrix(parcours.direct.prix);
    texte.appendChild(titre);

    var detail = document.createElement('small');
    if (parcours.portionsHorsAutoroute.length > 0) {
      detail.className = 'parcours-hors-autoroute';
      detail.textContent = '⚠ ' + parcours.kmHorsAutoroute + ' km hors autoroute : ' +
        parcours.portionsHorsAutoroute.map(function (portion) { return portion.via; }).join(', ');
    } else {
      detail.className = 'parcours-tout-autoroute';
      detail.textContent = '✓ Intégralement sur autoroute';
    }
    texte.appendChild(detail);

    etiquette.appendChild(radio);
    etiquette.appendChild(texte);
    return etiquette;
  }

  /** Affiche les tarifs (direct + tags 1-5 sorties) du parcours sélectionné. */
  function afficherParcours(index) {
    var resultat = resultatCourant;
    var parcours = resultat.parcours[index];
    indexParcoursCourant = index;
    alternativeCourante = null;

    popupTrajet.textContent = resultat.depart.nom + ' (' + resultat.depart.autoroute + ') → ' +
      resultat.arrivee.nom + ' (' + resultat.arrivee.autoroute + ') — environ ' +
      parcours.distanceKm + ' km, ' + parcours.description;

    if (parcours.portionsHorsAutoroute.length > 0) {
      infoHorsAutoroute.textContent = '⚠ Ce parcours comprend ' + parcours.kmHorsAutoroute +
        ' km hors autoroute : ' +
        parcours.portionsHorsAutoroute.map(function (portion) { return portion.via; }).join(', ') + '.';
      infoHorsAutoroute.hidden = false;
    } else {
      infoHorsAutoroute.hidden = true;
    }

    prixDirect.textContent = formaterPrix(parcours.direct.prix);

    tagsSorties.innerHTML = '';
    detailSorties.hidden = true;

    if (parcours.alternatives.length === 0) {
      var vide = document.createElement('p');
      vide.textContent = 'Pas de gare intermédiaire sur ce trajet : le tarif direct est le seul possible.';
      vide.className = 'popup-trajet';
      tagsSorties.appendChild(vide);
    }

    parcours.alternatives.forEach(function (alternative) {
      var tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'tag';

      var estMeilleur = parcours.meilleurPrix.sorties === alternative.sorties &&
                        alternative.prix < parcours.direct.prix;
      if (estMeilleur) tag.classList.add('tag-meilleur');
      if (alternative.economie <= 0) tag.classList.add('tag-sans-gain');

      var libelle = document.createElement('span');
      libelle.textContent = alternative.sorties + (alternative.sorties > 1 ? ' sorties' : ' sortie');
      var prix = document.createElement('span');
      prix.className = 'tag-prix';
      prix.textContent = formaterPrix(alternative.prix);
      tag.appendChild(libelle);
      tag.appendChild(prix);

      if (alternative.economie > 0) {
        var economie = document.createElement('span');
        economie.className = 'tag-economie';
        economie.textContent = '−' + formaterPrix(alternative.economie);
        tag.appendChild(economie);
      }

      tag.addEventListener('click', function () {
        Array.prototype.forEach.call(tagsSorties.children, function (t) { t.classList.remove('tag-actif'); });
        tag.classList.add('tag-actif');
        afficherDetail(alternative);
      });

      tagsSorties.appendChild(tag);
    });

    var meilleure = parcours.alternatives.find(function (a) {
      return a.sorties === parcours.meilleurPrix.sorties;
    });
    if (meilleure && meilleure.economie > 0) {
      popupNote.textContent = 'Meilleur plan : ' + meilleure.sorties +
        (meilleure.sorties > 1 ? ' sorties' : ' sortie') + ' intermédiaire' + (meilleure.sorties > 1 ? 's' : '') +
        ', soit ' + formaterPrix(meilleure.economie) + ' d’économie par rapport au trajet direct. ' +
        'Cliquez sur un tag pour voir où sortir. Tarifs du ' +
        new Date(resultat.tarifs.derniereMiseAJour).toLocaleDateString('fr-FR') + '.';
      afficherDetail(meilleure);
      var indexMeilleure = parcours.alternatives.indexOf(meilleure);
      if (tagsSorties.children[indexMeilleure]) {
        tagsSorties.children[indexMeilleure].classList.add('tag-actif');
      }
    } else {
      popupNote.textContent = 'Sur ce trajet, aucune sortie intermédiaire ne fait baisser le prix : ' +
        'le tarif direct est déjà le moins cher. Tarifs du ' +
        new Date(resultat.tarifs.derniereMiseAJour).toLocaleDateString('fr-FR') + '.';
    }
  }

  function afficherDetail(alternative) {
    alternativeCourante = alternative;
    detailTitre.textContent = 'Où sortir avec ' + alternative.sorties +
      (alternative.sorties > 1 ? ' sorties ' : ' sortie ') + '(' + formaterPrix(alternative.prix) + ')';
    detailListe.innerHTML = '';
    alternative.garesSortie.forEach(function (gare, index) {
      var element = document.createElement('li');
      element.textContent = 'Sortie ' + (index + 1) + ' : ' + gare.nom + ' (' + gare.autoroute +
        ') — sortez puis reprenez aussitôt l’autoroute';
      if (gare.bornes) element.appendChild(construireBornes(gare.bornes));
      detailListe.appendChild(element);
    });

    if (metaBornesCourante) {
      bornesMeta.textContent = '⚡ Bornes rapides (≥ ' + metaBornesCourante.puissanceMinKw +
        ' kW) à moins de ' + Math.round(metaBornesCourante.rayonMetres / 100) / 10 +
        ' km de la sortie — données du ' +
        new Date(metaBornesCourante.derniereMiseAJour).toLocaleDateString('fr-FR') +
        ' (' + metaBornesCourante.source + ').';
      bornesMeta.hidden = false;
    } else {
      bornesMeta.hidden = true;
    }

    detailSorties.hidden = false;
  }

  /** Liste des bornes de recharge rapide proches d'une gare de sortie. */
  function construireBornes(bornes) {
    var bloc = document.createElement('ul');
    bloc.className = 'liste-bornes';
    if (bornes.length === 0) {
      var aucune = document.createElement('li');
      aucune.className = 'borne borne-absente';
      aucune.textContent = 'Aucune borne rapide à moins d’1 km de cette sortie';
      bloc.appendChild(aucune);
      return bloc;
    }
    bornes.forEach(function (borne) {
      var element = document.createElement('li');
      element.className = 'borne';
      var texte = '⚡ ' + borne.nom;
      if (borne.puissanceKw) texte += ' — ' + borne.puissanceKw + ' kW';
      if (borne.distanceM !== null && borne.distanceM !== undefined) {
        texte += ' — à ' + borne.distanceM + ' m';
      }
      element.textContent = texte;
      // Enseigne accueillant la borne (ex. McDonald's) : pratique pour
      // recharger pendant la pause
      if (borne.enseigne) {
        var badge = document.createElement('span');
        badge.className = 'borne-enseigne';
        badge.textContent = '🍔 ' + borne.enseigne;
        element.appendChild(badge);
      }
      bloc.appendChild(element);
    });
    return bloc;
  }

  /* --- Pop-up carte OpenStreetMap ------------------------------------------ */

  /**
   * Ouvre la solution demandée sur une carte OpenStreetMap (Leaflet embarqué,
   * tuiles tile.openstreetmap.org) : tracé du parcours, départ, arrivée,
   * gares traversées et sorties conseillées avec leurs bornes éventuelles.
   */
  function ouvrirCarte(parcours, alternative) {
    var resultat = resultatCourant;

    titreCarte.textContent = alternative
      ? 'Solution ' + alternative.sorties + (alternative.sorties > 1 ? ' sorties' : ' sortie') +
        ' — ' + formaterPrix(alternative.prix)
      : 'Trajet direct sans sortie — ' + formaterPrix(parcours.direct.prix);
    carteSousTitre.textContent = resultat.depart.nom + ' → ' + resultat.arrivee.nom +
      ' — ' + parcours.distanceKm + ' km, ' + parcours.description;

    voileCarte.hidden = false;
    document.body.style.overflow = 'hidden';

    // Réinitialise la carte à chaque ouverture
    if (carteLeaflet) { carteLeaflet.remove(); carteLeaflet = null; }
    carteLeaflet = L.map('carte', { scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(carteLeaflet);

    var etapes = parcours.itineraire.filter(function (gare) {
      return typeof gare.lat === 'number' && typeof gare.lon === 'number';
    });
    var points = etapes.map(function (gare) { return [gare.lat, gare.lon]; });

    var trace = L.polyline(points, { color: '#1a7f4b', weight: 4, opacity: 0.85 }).addTo(carteLeaflet);

    var idsSortie = {};
    (alternative ? alternative.garesSortie : []).forEach(function (gare) { idsSortie[gare.id] = gare; });

    etapes.forEach(function (gare, index) {
      var estDepart = index === 0;
      var estArrivee = index === etapes.length - 1;
      var sortie = idsSortie[gare.id];

      var style;
      if (estDepart) style = { radius: 9, color: '#115c36', fillColor: '#1a7f4b', fillOpacity: 1 };
      else if (estArrivee) style = { radius: 9, color: '#7f1d1d', fillColor: '#c0392b', fillOpacity: 1 };
      else if (sortie) style = { radius: 8, color: '#9a6200', fillColor: '#f5a623', fillOpacity: 1 };
      else style = { radius: 4, color: '#5a6672', fillColor: '#b8c4cf', fillOpacity: 0.9 };

      var marqueur = L.circleMarker([gare.lat, gare.lon], Object.assign({ weight: 2 }, style))
        .addTo(carteLeaflet);

      var contenu = '<strong>' + gare.nom + '</strong> (' + gare.autoroute + ')';
      if (estDepart) contenu += '<br>Départ';
      if (estArrivee) contenu += '<br>Arrivée';
      if (sortie) {
        contenu += '<br>Sortie conseillée : sortez puis reprenez aussitôt l’autoroute';
        (sortie.bornes || []).forEach(function (borne) {
          contenu += '<br>⚡ ' + borne.nom + (borne.puissanceKw ? ' — ' + borne.puissanceKw + ' kW' : '') +
                     (borne.distanceM ? ' — à ' + borne.distanceM + ' m' : '');
        });
      }
      marqueur.bindPopup(contenu);
    });

    carteLeaflet.fitBounds(trace.getBounds(), { padding: [30, 30] });
    // La carte est créée dans une pop-up qui vient d'apparaître : recalcule sa taille
    setTimeout(function () { if (carteLeaflet) carteLeaflet.invalidateSize(); }, 60);
  }

  function fermerCarte() {
    voileCarte.hidden = true;
    if (carteLeaflet) { carteLeaflet.remove(); carteLeaflet = null; }
    // La pop-up de résultat est toujours ouverte derrière
    document.body.style.overflow = voile.hidden ? '' : 'hidden';
  }

  boutonCarteDirect.addEventListener('click', function () {
    ouvrirCarte(resultatCourant.parcours[indexParcoursCourant], null);
  });
  boutonCarteDetail.addEventListener('click', function () {
    ouvrirCarte(resultatCourant.parcours[indexParcoursCourant], alternativeCourante);
  });
  boutonFermerCarte.addEventListener('click', fermerCarte);
  voileCarte.addEventListener('click', function (evenement) {
    if (evenement.target === voileCarte) fermerCarte();
  });

  /* --- Pop-up d'envoi vers Waze -------------------------------------------- */

  /** Lien universel Waze : ouvre l'application (mobile) ou la carte live (bureau). */
  function lienWaze(lat, lon) {
    return 'https://www.waze.com/ul?ll=' + lat + '%2C' + lon + '&navigate=yes&zoom=16';
  }

  /**
   * Ouvre le panneau « Envoyer vers Waze » pour la solution demandée : la
   * liste ordonnée des étapes du trajet (entrée d'autoroute, sorties
   * conseillées, arrivée), chacune avec son lien de navigation Waze. Waze ne
   * gère pas les étapes multiples dans un même lien, d'où le pas-à-pas.
   */
  function ouvrirWaze(parcours, alternative) {
    var resultat = resultatCourant;

    wazeSousTitre.textContent = resultat.depart.nom + ' → ' + resultat.arrivee.nom +
      (alternative
        ? ' — solution ' + alternative.sorties + (alternative.sorties > 1 ? ' sorties' : ' sortie') +
          ' (' + formaterPrix(alternative.prix) + ')'
        : ' — trajet direct (' + formaterPrix(parcours.direct.prix) + ')');

    var etapes = [{ role: "Entrée d'autoroute", gare: resultat.depart }];
    (alternative ? alternative.garesSortie : []).forEach(function (gare, index) {
      etapes.push({ role: 'Arrêt ' + (index + 1) + ' — sortez puis reprenez l’autoroute', gare: gare });
    });
    etapes.push({ role: 'Arrivée', gare: resultat.arrivee });

    wazeEtapes.innerHTML = '';
    etapes.forEach(function (etape) {
      var element = document.createElement('li');

      var lien = document.createElement('a');
      lien.className = 'waze-lien';
      lien.href = lienWaze(etape.gare.lat, etape.gare.lon);
      lien.target = '_blank';
      lien.rel = 'noopener';

      var role = document.createElement('strong');
      role.textContent = etape.role;
      var nom = document.createElement('span');
      nom.textContent = etape.gare.nom + ' (' + etape.gare.autoroute + ')';
      lien.appendChild(role);
      lien.appendChild(nom);

      var bornes = etape.gare.bornes || [];
      if (bornes.length > 0) {
        var borne = document.createElement('small');
        borne.textContent = '⚡ ' + bornes.map(function (b) { return b.nom; }).join(' · ');
        lien.appendChild(borne);
      }

      element.appendChild(lien);
      wazeEtapes.appendChild(element);
    });

    voileWaze.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function fermerWaze() {
    voileWaze.hidden = true;
    document.body.style.overflow = voile.hidden ? '' : 'hidden';
  }

  boutonWazeDirect.addEventListener('click', function () {
    ouvrirWaze(resultatCourant.parcours[indexParcoursCourant], null);
  });
  boutonWazeDetail.addEventListener('click', function () {
    ouvrirWaze(resultatCourant.parcours[indexParcoursCourant], alternativeCourante);
  });
  boutonFermerWaze.addEventListener('click', fermerWaze);
  voileWaze.addEventListener('click', function (evenement) {
    if (evenement.target === voileWaze) fermerWaze();
  });

  function fermerPopup() {
    voile.hidden = true;
    document.body.style.overflow = '';
  }

  boutonFermer.addEventListener('click', fermerPopup);
  voile.addEventListener('click', function (evenement) {
    if (evenement.target === voile) fermerPopup();
  });
  document.addEventListener('keydown', function (evenement) {
    if (evenement.key !== 'Escape') return;
    if (!voileWaze.hidden) return fermerWaze();
    if (!voileCarte.hidden) return fermerCarte();
    if (!voile.hidden) fermerPopup();
  });

  initialiser();
})();
