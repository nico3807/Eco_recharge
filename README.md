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

## Pourquoi sortir de l'autoroute peut coûter moins cher ?

Le prix des péages n'est pas proportionnel à la distance : plus le trajet sans
sortie est long, plus le prix au kilomètre augmente. En sortant à une gare
intermédiaire puis en rentrant aussitôt, le « compteur » repart de zéro — le
total des tronçons peut alors être inférieur au tarif direct.

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

Réponse (extrait) :

```json
{
  "depart":   { "id": "a6-fleury", "nom": "Fleury-en-Bière", "autoroute": "A6" },
  "arrivee":  { "id": "a7-marseille", "nom": "Marseille (Saint-Charles)", "autoroute": "A7" },
  "distanceKm": 735,
  "direct":   { "sorties": 0, "prix": 158.4 },
  "alternatives": [
    { "sorties": 1, "prix": 128.3, "economie": 30.1, "garesSortie": [ ... ] },
    { "sorties": 2, "prix": 118.6, "economie": 39.8, "garesSortie": [ ... ] }
  ],
  "meilleurPrix": { "sorties": 5, "prix": 112.4 }
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
├── index.html          Interface (formulaire + pop-up de résultat)
├── css/style.css       Styles responsive (mobile first)
├── js/app.js           Logique de l'interface (fetch API, pop-up, tags)
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
