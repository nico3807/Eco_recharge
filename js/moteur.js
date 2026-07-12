/**
 * Moteur de calcul des trajets autoroutiers les moins chers.
 *
 * Principe (identique à autoroute-eco.fr) : le prix d'un péage n'est pas
 * proportionnel à la distance — plus le trajet sans sortie est long, plus le
 * prix au kilomètre augmente. Sortir de l'autoroute à une gare intermédiaire
 * puis y rentrer aussitôt "remet le compteur à zéro" et peut faire baisser le
 * prix total. Ce moteur calcule le tarif direct puis le découpage optimal du
 * trajet en 1, 2, 3, 4 ou 5 sorties.
 *
 * Fichier utilisable côté serveur (Node.js, module.exports) et côté
 * navigateur (objet global `MoteurEco`).
 */
(function (racine) {
  'use strict';

  /**
   * Construit le graphe du réseau : chaque gare est un nœud, chaque portion
   * d'autoroute entre deux gares consécutives est une arête payante, chaque
   * jonction entre autoroutes est une arête gratuite.
   */
  function construireGraphe(reseau) {
    var gares = {};
    var voisins = {};

    function ajouterArete(de, a, arete) {
      if (!voisins[de]) voisins[de] = [];
      voisins[de].push(Object.assign({ vers: a }, arete));
    }

    reseau.autoroutes.forEach(function (autoroute) {
      autoroute.gares.forEach(function (gare, i) {
        gares[gare.id] = {
          id: gare.id,
          nom: gare.nom,
          autoroute: autoroute.code,
          nomAutoroute: autoroute.nom
        };
        if (i > 0) {
          var precedente = autoroute.gares[i - 1];
          var km = Math.abs(gare.km - precedente.km);
          ajouterArete(precedente.id, gare.id, { km: km, autoroute: autoroute.code, gratuit: false });
          ajouterArete(gare.id, precedente.id, { km: km, autoroute: autoroute.code, gratuit: false });
        }
      });
    });

    reseau.jonctions.forEach(function (jonction) {
      ajouterArete(jonction.de, jonction.a, { km: 0, autoroute: null, gratuit: true, via: jonction.via });
      ajouterArete(jonction.a, jonction.de, { km: 0, autoroute: null, gratuit: true, via: jonction.via });
    });

    return { gares: gares, voisins: voisins };
  }

  /**
   * Plus court chemin (Dijkstra) entre deux gares, pondéré par la distance.
   * Les jonctions gratuites comptent pour une distance symbolique afin
   * d'éviter les allers-retours inutiles entre autoroutes.
   */
  function plusCourtChemin(graphe, departId, arriveeId) {
    var distances = {};
    var precedents = {};
    var visites = {};
    var file = [{ id: departId, distance: 0 }];
    distances[departId] = 0;

    while (file.length > 0) {
      file.sort(function (a, b) { return a.distance - b.distance; });
      var courant = file.shift();
      if (visites[courant.id]) continue;
      visites[courant.id] = true;
      if (courant.id === arriveeId) break;

      (graphe.voisins[courant.id] || []).forEach(function (arete) {
        var poids = arete.gratuit ? 0.5 : arete.km;
        var d = courant.distance + poids;
        if (distances[arete.vers] === undefined || d < distances[arete.vers]) {
          distances[arete.vers] = d;
          precedents[arete.vers] = { id: courant.id, arete: arete };
          file.push({ id: arete.vers, distance: d });
        }
      });
    }

    if (distances[arriveeId] === undefined) return null;

    var chemin = [];
    var noeud = arriveeId;
    while (noeud !== departId) {
      var p = precedents[noeud];
      chemin.unshift({ id: noeud, arete: p.arete });
      noeud = p.id;
    }
    chemin.unshift({ id: departId, arete: null });
    return chemin;
  }

  /** Arrondit un prix au pas de la grille tarifaire (10 centimes par défaut). */
  function arrondirPrix(prix, tarifs) {
    var pas = tarifs.arrondi || 0.1;
    return Math.round(Math.ceil(prix / pas - 1e-9) * pas * 100) / 100;
  }

  /**
   * Prix d'un parcours SANS sortie entre deux positions du chemin.
   * Le coût kilométrique de base est majoré d'un coefficient croissant avec
   * la distance parcourue d'une traite — c'est cette non-linéarité qui rend
   * les sorties intermédiaires rentables.
   */
  function prixTroncon(chemin, debut, fin, tarifs) {
    var cout = 0;
    var kmPayants = 0;
    for (var i = debut + 1; i <= fin; i++) {
      var arete = chemin[i].arete;
      if (arete.gratuit) continue;
      var taux = tarifs.tauxParKm[arete.autoroute] || 0.11;
      cout += arete.km * taux;
      kmPayants += arete.km;
    }
    if (kmPayants === 0) return 0;
    var majoration = 1 + (tarifs.coefficientDistance || 0) * kmPayants;
    return arrondirPrix(cout * majoration, tarifs);
  }

  /** Distance totale (km) du chemin, jonctions gratuites comprises. */
  function distanceTotale(chemin) {
    var km = 0;
    for (var i = 1; i < chemin.length; i++) km += chemin[i].arete.km;
    return km;
  }

  /**
   * Meilleur découpage du chemin avec EXACTEMENT nbSorties arrêts
   * intermédiaires (programmation dynamique sur les gares du chemin).
   * Retourne null si le chemin n'a pas assez de gares intermédiaires.
   */
  function meilleurDecoupage(chemin, nbSorties, tarifs, prixMemo) {
    var n = chemin.length - 1;
    if (nbSorties >= chemin.length - 1) return null;

    function prix(i, j) {
      var cle = i + '-' + j;
      if (prixMemo[cle] === undefined) prixMemo[cle] = prixTroncon(chemin, i, j, tarifs);
      return prixMemo[cle];
    }

    // dp[s][i] : coût minimal pour atteindre la gare i avec s sorties déjà faites
    var dp = [];
    var choix = [];
    for (var s = 0; s <= nbSorties; s++) {
      dp.push(new Array(n + 1).fill(Infinity));
      choix.push(new Array(n + 1).fill(-1));
    }
    for (var i = 1; i <= n; i++) dp[0][i] = prix(0, i);

    for (s = 1; s <= nbSorties; s++) {
      for (i = s + 1; i <= n; i++) {
        for (var p = s; p < i; p++) {
          if (dp[s - 1][p] === Infinity) continue;
          var total = dp[s - 1][p] + prix(p, i);
          if (total < dp[s][i]) {
            dp[s][i] = total;
            choix[s][i] = p;
          }
        }
      }
    }

    if (dp[nbSorties][n] === Infinity) return null;

    var sorties = [];
    var position = n;
    for (s = nbSorties; s >= 1; s--) {
      position = choix[s][position];
      sorties.unshift(position);
    }

    return {
      prix: Math.round(dp[nbSorties][n] * 100) / 100,
      sorties: sorties.map(function (index) { return chemin[index].id; })
    };
  }

  /**
   * Calcule le trajet complet : tarif direct (sans sortie) et meilleures
   * alternatives avec 1 à maxSorties sorties intermédiaires.
   */
  function calculerTrajet(reseau, tarifs, departId, arriveeId, maxSorties) {
    maxSorties = maxSorties || 5;
    var graphe = construireGraphe(reseau);
    var depart = graphe.gares[departId];
    var arrivee = graphe.gares[arriveeId];

    if (!depart) return { erreur: 'Gare de départ inconnue : ' + departId };
    if (!arrivee) return { erreur: "Gare d'arrivée inconnue : " + arriveeId };
    if (departId === arriveeId) return { erreur: "Les gares d'entrée et de sortie doivent être différentes." };

    var chemin = plusCourtChemin(graphe, departId, arriveeId);
    if (!chemin) return { erreur: 'Aucun itinéraire autoroutier entre ces deux gares.' };

    var prixMemo = {};
    var n = chemin.length - 1;
    var prixDirect = prixTroncon(chemin, 0, n, tarifs);

    function decrireGare(id) {
      var gare = graphe.gares[id];
      return { id: gare.id, nom: gare.nom, autoroute: gare.autoroute };
    }

    var alternatives = [];
    for (var s = 1; s <= maxSorties; s++) {
      var decoupage = meilleurDecoupage(chemin, s, tarifs, prixMemo);
      if (!decoupage) break;
      alternatives.push({
        sorties: s,
        prix: decoupage.prix,
        economie: Math.round((prixDirect - decoupage.prix) * 100) / 100,
        garesSortie: decoupage.sorties.map(decrireGare)
      });
    }

    var meilleure = alternatives.reduce(function (best, alt) {
      return alt.prix < best.prix ? alt : best;
    }, { prix: prixDirect, sorties: 0 });

    return {
      depart: decrireGare(departId),
      arrivee: decrireGare(arriveeId),
      distanceKm: Math.round(distanceTotale(chemin)),
      itineraire: chemin.map(function (etape) { return decrireGare(etape.id); }),
      direct: { sorties: 0, prix: prixDirect, economie: 0 },
      alternatives: alternatives,
      meilleurPrix: { sorties: meilleure.sorties, prix: meilleure.prix },
      tarifs: {
        derniereMiseAJour: tarifs.derniereMiseAJour,
        classeVehicule: tarifs.classeVehicule
      }
    };
  }

  /** Liste plate de toutes les gares (pour l'autocomplétion et l'API). */
  function listerGares(reseau) {
    var liste = [];
    reseau.autoroutes.forEach(function (autoroute) {
      autoroute.gares.forEach(function (gare) {
        liste.push({
          id: gare.id,
          nom: gare.nom,
          autoroute: autoroute.code,
          libelle: gare.nom + ' (' + autoroute.code + ')'
        });
      });
    });
    liste.sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); });
    return liste;
  }

  var api = {
    construireGraphe: construireGraphe,
    plusCourtChemin: plusCourtChemin,
    calculerTrajet: calculerTrajet,
    listerGares: listerGares
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    racine.MoteurEco = api;
  }
})(typeof self !== 'undefined' ? self : this);
