/**
 * Moteur de calcul des trajets autoroutiers les moins chers.
 *
 * Principe (identique à autoroute-eco.fr) : les grilles de péage favorisent
 * les trajets courts (tarif au kilomètre plus bas, pensé pour les riverains).
 * Rester sur l'autoroute de bout en bout coûte donc plus cher au kilomètre
 * que d'enchaîner plusieurs tronçons courts : sortir à une gare intermédiaire
 * puis reprendre aussitôt l'autoroute « remet le compteur à zéro » et fait
 * économiser de l'ordre de 5 à 25 % selon les trajets. Ce moteur calcule le
 * tarif direct puis le découpage optimal en 1 à 5 sorties.
 *
 * Lorsqu'un itinéraire emprunte une portion hors autoroute (traversée de
 * Lyon, rocade de Bordeaux, Francilienne…), plusieurs parcours sont proposés
 * pour laisser le choix à l'utilisateur.
 *
 * Fichier utilisable côté serveur (Node.js, module.exports) et côté
 * navigateur (objet global `MoteurEco`).
 */
(function (racine) {
  'use strict';

  /**
   * Construit le graphe du réseau : chaque gare est un nœud, chaque portion
   * d'autoroute entre deux gares consécutives est une arête payante, chaque
   * jonction est une arête gratuite (sur autoroute ou non selon le réseau).
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
          ajouterArete(precedente.id, gare.id, { km: km, autoroute: autoroute.code, gratuit: false, horsAutoroute: false });
          ajouterArete(gare.id, precedente.id, { km: km, autoroute: autoroute.code, gratuit: false, horsAutoroute: false });
        }
      });
    });

    reseau.jonctions.forEach(function (jonction) {
      var arete = {
        km: jonction.km || 0,
        autoroute: null,
        gratuit: true,
        horsAutoroute: !!jonction.horsAutoroute,
        via: jonction.via
      };
      ajouterArete(jonction.de, jonction.a, arete);
      ajouterArete(jonction.a, jonction.de, arete);
    });

    return { gares: gares, voisins: voisins };
  }

  /**
   * Plus court chemin (Dijkstra) entre deux gares, pondéré par la distance.
   * `interdit` (optionnel) est un prédicat qui exclut certaines arêtes,
   * utilisé pour construire des parcours alternatifs.
   */
  function plusCourtChemin(graphe, departId, arriveeId, interdit) {
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
        if (interdit && interdit(arete)) return;
        var d = courant.distance + arete.km;
        if (distances[arete.vers] === undefined || d < distances[arete.vers]) {
          distances[arete.vers] = d;
          precedents[arete.vers] = { id: courant.id, arete: arete };
          file.push({ id: arete.vers, distance: d });
        }
      });
    }

    if (!visites[arriveeId]) return null;

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

  /** Clé d'identité d'un chemin (pour dédoublonner les parcours). */
  function cleChemin(chemin) {
    return chemin.map(function (etape) { return etape.id; }).join('>');
  }

  /**
   * Portions hors autoroute empruntées par un chemin, regroupées par nom
   * (les kilomètres de plusieurs tronçons portant le même nom s'additionnent).
   */
  function portionsHorsAutoroute(chemin) {
    var portions = [];
    var parVia = {};
    for (var i = 1; i < chemin.length; i++) {
      var arete = chemin[i].arete;
      if (!arete.horsAutoroute) continue;
      if (!parVia[arete.via]) {
        parVia[arete.via] = { via: arete.via, km: 0 };
        portions.push(parVia[arete.via]);
      }
      parVia[arete.via].km += arete.km;
    }
    return portions;
  }

  /**
   * Liste jusqu'à trois parcours possibles entre deux gares. Le premier est
   * le plus court. Si celui-ci comprend des portions hors autoroute, on
   * propose aussi (quand ils existent) : un parcours évitant toute portion
   * hors autoroute, et un parcours évitant les portions du premier.
   */
  function listerParcours(graphe, departId, arriveeId) {
    var principal = plusCourtChemin(graphe, departId, arriveeId);
    if (!principal) return [];

    var parcours = [principal];
    var cles = {};
    cles[cleChemin(principal)] = true;

    if (portionsHorsAutoroute(principal).length > 0) {
      var toutAutoroute = plusCourtChemin(graphe, departId, arriveeId, function (arete) {
        return arete.horsAutoroute;
      });

      var viasUtilises = {};
      portionsHorsAutoroute(principal).forEach(function (portion) { viasUtilises[portion.via] = true; });
      var autreCorridor = plusCourtChemin(graphe, departId, arriveeId, function (arete) {
        return arete.horsAutoroute && viasUtilises[arete.via];
      });

      [toutAutoroute, autreCorridor].forEach(function (chemin) {
        if (!chemin) return;
        var cle = cleChemin(chemin);
        if (!cles[cle] && parcours.length < 3) {
          cles[cle] = true;
          parcours.push(chemin);
        }
      });
    }

    return parcours;
  }

  /** Arrondit un prix au pas de la grille tarifaire (10 centimes par défaut). */
  function arrondirPrix(prix, tarifs) {
    var pas = tarifs.arrondi || 0.1;
    return Math.round(Math.ceil(prix / pas - 1e-9) * pas * 100) / 100;
  }

  /**
   * Prix d'un parcours SANS sortie entre deux positions du chemin.
   * Le coût kilométrique de base est majoré d'un coefficient croissant avec
   * la distance payante parcourue d'une traite — les grilles réelles
   * favorisent les trajets courts, c'est cette non-linéarité (de l'ordre de
   * quelques pourcents par centaine de kilomètres) qui rend les sorties
   * intermédiaires rentables.
   */
  function prixTroncon(chemin, debut, fin, tarifs) {
    var cout = 0;
    var kmPayants = 0;
    for (var i = debut + 1; i <= fin; i++) {
      var arete = chemin[i].arete;
      if (arete.gratuit) continue;
      var taux = tarifs.tauxParKm[arete.autoroute] || 0.085;
      cout += arete.km * taux;
      kmPayants += arete.km;
    }
    if (kmPayants === 0) return 0;
    var majoration = 1 + (tarifs.coefficientDistance || 0) * kmPayants;
    return arrondirPrix(cout * majoration, tarifs);
  }

  /** Distance totale (km) du chemin, jonctions comprises. */
  function distanceTotale(chemin) {
    var km = 0;
    for (var i = 1; i < chemin.length; i++) km += chemin[i].arete.km;
    return km;
  }

  /** Kilomètres soumis à péage sur le chemin (hors jonctions gratuites). */
  function distancePayante(chemin) {
    var km = 0;
    for (var i = 1; i < chemin.length; i++) {
      if (!chemin[i].arete.gratuit) km += chemin[i].arete.km;
    }
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

  /** Description courte d'un parcours : « par A6, A7 ». */
  function decrireParcours(chemin, graphe) {
    var codes = [];
    for (var i = 1; i < chemin.length; i++) {
      var code = chemin[i].arete.autoroute;
      if (code && codes[codes.length - 1] !== code) codes.push(code);
    }
    return 'par ' + codes.join(', ');
  }

  /** Calcule tarif direct + alternatives 1..maxSorties pour un chemin donné. */
  function calculerParcours(chemin, graphe, tarifs, maxSorties) {
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

    var portions = portionsHorsAutoroute(chemin);

    return {
      description: decrireParcours(chemin, graphe),
      distanceKm: Math.round(distanceTotale(chemin)),
      kmPayants: Math.round(distancePayante(chemin)),
      kmHorsAutoroute: Math.round(portions.reduce(function (somme, portion) { return somme + portion.km; }, 0)),
      portionsHorsAutoroute: portions,
      itineraire: chemin.map(function (etape) { return decrireGare(etape.id); }),
      direct: { sorties: 0, prix: prixDirect, economie: 0 },
      alternatives: alternatives,
      meilleurPrix: { sorties: meilleure.sorties, prix: meilleure.prix }
    };
  }

  /**
   * Calcule le trajet complet : un ou plusieurs parcours possibles (le choix
   * est proposé quand le plus court comprend une portion hors autoroute),
   * chacun avec tarif direct et meilleures alternatives 1 à maxSorties.
   */
  function calculerTrajet(reseau, tarifs, departId, arriveeId, maxSorties) {
    maxSorties = maxSorties || 5;
    var graphe = construireGraphe(reseau);
    var depart = graphe.gares[departId];
    var arrivee = graphe.gares[arriveeId];

    if (!depart) return { erreur: 'Gare de départ inconnue : ' + departId };
    if (!arrivee) return { erreur: "Gare d'arrivée inconnue : " + arriveeId };
    if (departId === arriveeId) return { erreur: "Les gares d'entrée et de sortie doivent être différentes." };

    var chemins = listerParcours(graphe, departId, arriveeId);
    if (chemins.length === 0) return { erreur: 'Aucun itinéraire autoroutier entre ces deux gares.' };

    function decrireGare(id) {
      var gare = graphe.gares[id];
      return { id: gare.id, nom: gare.nom, autoroute: gare.autoroute };
    }

    return {
      depart: decrireGare(departId),
      arrivee: decrireGare(arriveeId),
      parcours: chemins.map(function (chemin) {
        return calculerParcours(chemin, graphe, tarifs, maxSorties);
      }),
      tarifs: {
        derniereMiseAJour: tarifs.derniereMiseAJour,
        classeVehicule: tarifs.classeVehicule
      }
    };
  }

  /**
   * Option « Avec recharge électrique » : annote chaque gare de sortie
   * proposée avec les bornes de recharge rapide situées à moins de 1 km
   * (données de data/bornes.json, issues du portail data.smartidf.services).
   */
  function attacherBornes(resultat, bornes) {
    if (resultat.erreur || !bornes) return resultat;
    resultat.parcours.forEach(function (parcours) {
      parcours.alternatives.forEach(function (alternative) {
        alternative.garesSortie.forEach(function (gare) {
          gare.bornes = bornes.parGare[gare.id] || [];
        });
      });
    });
    resultat.bornesMeta = {
      derniereMiseAJour: bornes.derniereMiseAJour,
      rayonMetres: bornes.rayonMetres,
      puissanceMinKw: bornes.puissanceMinKw,
      source: bornes.source
    };
    return resultat;
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
    listerParcours: listerParcours,
    calculerTrajet: calculerTrajet,
    attacherBornes: attacherBornes,
    listerGares: listerGares
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    racine.MoteurEco = api;
  }
})(typeof self !== 'undefined' ? self : this);
