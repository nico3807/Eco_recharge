# 🛣️ Éco-Péage

Application web responsive qui calcule, sur le principe d'[autoroute-eco.fr](https://autoroute-eco.fr/),
les trajets **les moins chers sur les autoroutes françaises à péage**.

L'utilisateur choisit une **gare de péage d'entrée** et une **gare de sortie** parmi
les autoroutes françaises couvertes. Après validation, une **pop-up** affiche :

- le **tarif direct** (sans sortie d'autoroute) ;
- des **tags 1, 2, 3, 4 et 5 sorties** donnant le tarif le moins cher obtenu en
  sortant à des gares intermédiaires puis en reprenant aussitôt l'autoroute,
  avec l'économie réalisée et le détail des gares où sortir.

Avec l'option **⚡ Avec recharge électrique**, le détail de chaque sortie
proposée affiche en plus les **bornes de recharge rapide (≥ 50 kW) situées à
moins d'1 km** de la gare de sortie : nom, opérateur, puissance et distance.
Les bornes installées chez des **enseignes** sont identifiées par un badge —
notamment les **McDonald's**, dont les parkings sont équipés de bornes rapides
Izivia 150 kW (pratique pour recharger pendant la pause). Le script de mise à
jour les détecte dans les données OSM via les champs name/brand/operator.

Chaque solution (trajet direct ou découpage en 1-5 sorties) dispose d'un
bouton **🗺 Afficher sur la carte** qui ouvre le parcours dans une seconde
pop-up sur fond **OpenStreetMap** (bibliothèque Leaflet embarquée dans
`js/vendor/leaflet/`, tuiles tile.openstreetmap.org) : tracé du trajet,
départ, arrivée, gares traversées et sorties conseillées — avec leurs bornes
de recharge au clic quand l'option ⚡ est active.

Le bouton **🚗 Dans Waze** envoie la solution vers l'application **Waze** :
un panneau liste le trajet en étapes ordonnées (entrée d'autoroute, chaque
sortie conseillée avec ses bornes, arrivée), chacune avec son lien de
navigation `waze.com/ul` qui ouvre l'appli et démarre le guidage sur mobile.
Les [liens web Waze](https://developers.google.com/waze/deeplinks) ne
transmettent qu'une destination à la fois (« Ajouter un arrêt » n'existe qu'à
l'intérieur de l'application, pour un seul arrêt actif) : on lance donc
l'étape suivante à chaque arrêt, ou l'arrivée directement en ajoutant les
arrêts depuis Waze.

Si l'itinéraire le plus court comprend une **portion hors autoroute**
(traversée de Lyon, rocade de Bordeaux, Francilienne…), la pop-up propose
d'abord le **choix du parcours** : chaque option indique la distance, le tarif
direct et les portions hors autoroute (ou « intégralement sur autoroute »), et
les tarifs se recalculent selon le parcours choisi.

## Pourquoi sortir de l'autoroute peut coûter moins cher ?

Les grilles de péage favorisent les trajets courts (tarif au kilomètre plus
bas, pensé pour les riverains) : rester sur l'autoroute de bout en bout coûte
donc plus cher au kilomètre. En sortant à une gare intermédiaire puis en
rentrant aussitôt, le « compteur » repart de zéro — le total des tronçons est
alors inférieur au tarif direct, avec des **économies de l'ordre de 5 à 25 %**
selon les trajets (cf. [autoroute-eco.fr](https://autoroute-eco.fr/) :
Paris→Marseille ≈ 58 € direct contre ≈ 51 € en fractionnant). Les taux et le
coefficient de la grille `data/tarifs.json` sont calibrés sur ces ordres de
grandeur réels.

## Démarrage

Aucune dépendance à installer (Node.js ≥ 14 uniquement) :

```bash
node server.js        # ou : npm start
```

Puis ouvrir <http://localhost:3000>.

> Le front fonctionne aussi sur un hébergement statique (ex. GitHub Pages) :
> sans API, il charge les fichiers `data/*.json` et calcule les trajets
> directement dans le navigateur.

## API REST

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/gares` | Liste des gares de péage (id, nom, autoroute) |
| GET | `/api/autoroutes` | Autoroutes couvertes |
| GET | `/api/tarifs` | Métadonnées de la grille tarifaire (date de mise à jour, taux) |
| GET | `/api/bornes` | Bornes de recharge rapide par gare de péage |
| GET | `/api/trajet?depart=ID&arrivee=ID[&sorties=1..5][&recharge=1]` | Calcul du trajet (`recharge=1` ajoute les bornes aux sorties proposées) |

Exemple :

```bash
curl "http://localhost:3000/api/trajet?depart=a6-fleury&arrivee=a7-marseille"
```

Réponse (extrait) — un ou plusieurs `parcours` sont renvoyés ; il y en a
plusieurs quand l'itinéraire le plus court comprend une portion hors
autoroute, pour laisser le choix à l'utilisateur :

```json
{
  "depart":   { "id": "a6-fleury", "nom": "Fleury-en-Bière", "autoroute": "A6" },
  "arrivee":  { "id": "a7-marseille", "nom": "Marseille (Saint-Charles)", "autoroute": "A7" },
  "parcours": [
    {
      "description": "par A6, A7",
      "distanceKm": 760,
      "kmPayants": 735,
      "kmHorsAutoroute": 25,
      "portionsHorsAutoroute": [ { "via": "Traversée de Lyon (M6/M7)", "km": 25 } ],
      "direct": { "sorties": 0, "prix": 68.3 },
      "alternatives": [
        { "sorties": 1, "prix": 63.9, "economie": 4.4, "garesSortie": [ ... ] }
      ],
      "meilleurPrix": { "sorties": 5, "prix": 61.2 }
    },
    {
      "description": "par A6, A7",
      "distanceKm": 765,
      "kmHorsAutoroute": 0,
      "direct": { "sorties": 0, "prix": 65.1 },
      "meilleurPrix": { "sorties": 5, "prix": 58.6 }
    }
  ]
}
```

## Mise à jour régulière des tarifs

Les tarifs vivent dans **`data/tarifs.json`** (taux €/km par autoroute,
coefficient de majoration à la distance, date de mise à jour). Le serveur
**relit automatiquement le fichier dès qu'il change** : il suffit de modifier
le JSON et d'actualiser la page, sans redémarrage.

```json
{
  "derniereMiseAJour": "2026-07-01",
  "tauxParKm": { "A6": 0.117, "A7": 0.112, ... }
}
```

Le réseau (gares, distances, jonctions, coordonnées GPS) est décrit dans
`data/reseau.json` et peut être enrichi de la même façon.

## Mise à jour des bornes de recharge électrique

Les bornes vivent dans **`data/bornes.json`** (bornes rapides ≥ 50 kW à moins
d'1 km de chaque gare de sortie), relu lui aussi à chaud par le serveur.
Pour le régénérer à partir des **données réelles OSM** du portail
[data.smartidf.services](https://data.smartidf.services/) (jeu de données
« Stations de recharge pour véhicule électrique - France - données OSM ») :

```bash
node scripts/maj-bornes.js
```

Le script retrouve le jeu de données dans le catalogue, interroge l'API pour
chaque gare (filtre géographique 1 km), garde les bornes rapides et écrit
`data/bornes.json`. À lancer régulièrement (cron, GitHub Action…).

> ⚠️ Le fichier `data/bornes.json` livré dans le dépôt contient des **données
> d'exemple** (l'environnement de développement n'avait pas accès au portail) :
> exécutez le script une fois pour les remplacer par les données réelles.

## Structure du projet

```
├── index.html          Interface (formulaire + pop-ups résultat et carte)
├── css/style.css       Styles responsive (mobile first)
├── js/app.js           Logique de l'interface (fetch API, pop-ups, tags, carte)
├── js/vendor/leaflet/  Bibliothèque Leaflet 1.9.4 embarquée (carte OSM)
├── js/moteur.js        Moteur de calcul partagé serveur/navigateur
│                       (graphe, Dijkstra, tarification, optimisation 1-5 sorties)
├── data/reseau.json    Gares de péage (avec coordonnées GPS) et jonctions
├── data/tarifs.json    Grille tarifaire — mise à jour régulièrement
├── data/bornes.json    Bornes de recharge rapide par gare — mise à jour régulièrement
├── scripts/maj-bornes.js  Régénère data/bornes.json depuis data.smartidf.services
└── server.js           Serveur web + API REST (Node.js sans dépendance)
```

## Avertissement

Projet de démonstration : les gares, distances et tarifs sont **indicatifs**.
Vérifiez les prix réels auprès des sociétés concessionnaires d'autoroutes.
