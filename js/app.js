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
  var messageErreur = document.getElementById('message-erreur');
  var metaTarifs = document.getElementById('meta-tarifs');

  var voile = document.getElementById('voile-popup');
  var boutonFermer = document.getElementById('bouton-fermer');
  var popupTrajet = document.getElementById('popup-trajet');
  var prixDirect = document.getElementById('prix-direct');
  var tagsSorties = document.getElementById('tags-sorties');
  var detailSorties = document.getElementById('detail-sorties');
  var detailTitre = document.getElementById('detail-titre');
  var detailListe = document.getElementById('detail-liste');
  var popupNote = document.getElementById('popup-note');

  var gares = [];
  var modeLocal = false;   // true si l'API est indisponible (calcul navigateur)
  var donneesLocales = null;

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

  function calculerTrajet(departId, arriveeId) {
    if (modeLocal) {
      var resultat = MoteurEco.calculerTrajet(donneesLocales.reseau, donneesLocales.tarifs, departId, arriveeId, 5);
      return resultat.erreur ? Promise.reject(new Error(resultat.erreur)) : Promise.resolve(resultat);
    }
    return fetch('/api/trajet?depart=' + encodeURIComponent(departId) +
                 '&arrivee=' + encodeURIComponent(arriveeId) + '&sorties=5')
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

    calculerTrajet(depart.id, arrivee.id)
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
    popupTrajet.textContent = resultat.depart.nom + ' (' + resultat.depart.autoroute + ') → ' +
      resultat.arrivee.nom + ' (' + resultat.arrivee.autoroute + ') — environ ' +
      resultat.distanceKm + ' km';

    prixDirect.textContent = formaterPrix(resultat.direct.prix);

    tagsSorties.innerHTML = '';
    detailSorties.hidden = true;

    if (resultat.alternatives.length === 0) {
      var vide = document.createElement('p');
      vide.textContent = 'Pas de gare intermédiaire sur ce trajet : le tarif direct est le seul possible.';
      vide.className = 'popup-trajet';
      tagsSorties.appendChild(vide);
    }

    resultat.alternatives.forEach(function (alternative) {
      var tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'tag';

      var estMeilleur = resultat.meilleurPrix.sorties === alternative.sorties &&
                        alternative.prix < resultat.direct.prix;
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

    var meilleure = resultat.alternatives.find(function (a) {
      return a.sorties === resultat.meilleurPrix.sorties;
    });
    if (meilleure && meilleure.economie > 0) {
      popupNote.textContent = 'Meilleur plan : ' + meilleure.sorties +
        (meilleure.sorties > 1 ? ' sorties' : ' sortie') + ' intermédiaire' + (meilleure.sorties > 1 ? 's' : '') +
        ', soit ' + formaterPrix(meilleure.economie) + ' d’économie par rapport au trajet direct. ' +
        'Cliquez sur un tag pour voir où sortir. Tarifs du ' +
        new Date(resultat.tarifs.derniereMiseAJour).toLocaleDateString('fr-FR') + '.';
      afficherDetail(meilleure);
      var indexMeilleure = resultat.alternatives.indexOf(meilleure);
      if (tagsSorties.children[indexMeilleure]) {
        tagsSorties.children[indexMeilleure].classList.add('tag-actif');
      }
    } else {
      popupNote.textContent = 'Sur ce trajet, aucune sortie intermédiaire ne fait baisser le prix : ' +
        'le tarif direct est déjà le moins cher. Tarifs du ' +
        new Date(resultat.tarifs.derniereMiseAJour).toLocaleDateString('fr-FR') + '.';
    }

    voile.hidden = false;
    document.body.style.overflow = 'hidden';
    boutonFermer.focus();
  }

  function afficherDetail(alternative) {
    detailTitre.textContent = 'Où sortir avec ' + alternative.sorties +
      (alternative.sorties > 1 ? ' sorties ' : ' sortie ') + '(' + formaterPrix(alternative.prix) + ')';
    detailListe.innerHTML = '';
    alternative.garesSortie.forEach(function (gare, index) {
      var element = document.createElement('li');
      element.textContent = 'Sortie ' + (index + 1) + ' : ' + gare.nom + ' (' + gare.autoroute +
        ') — sortez puis reprenez aussitôt l’autoroute';
      detailListe.appendChild(element);
    });
    detailSorties.hidden = false;
  }

  function fermerPopup() {
    voile.hidden = true;
    document.body.style.overflow = '';
  }

  boutonFermer.addEventListener('click', fermerPopup);
  voile.addEventListener('click', function (evenement) {
    if (evenement.target === voile) fermerPopup();
  });
  document.addEventListener('keydown', function (evenement) {
    if (evenement.key === 'Escape' && !voile.hidden) fermerPopup();
  });

  initialiser();
})();
