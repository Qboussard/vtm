# VTM — compagnon de session

Bot Discord pour une campagne de *Vampire : la Mascarade* (V5) : règles à portée de main, mémos de table, fiches de PNJ avec portrait et journal de campagne.

## Commandes

| Commande | Usage |
|---|---|
| `/regle [recherche] [public]` | Recherche une règle ou une Discipline (autocomplétion, insensible aux accents). Sans argument : sommaire navigable. Réponse privée avec bouton « Montrer à la table ». |
| `/memo [fiche] [public]` | Fiches de synthèse : jets, combat, Soif & Frénésie, Volonté & social. |
| `/pnj voir` · `liste` | Fiche avec portrait ; galerie filtrable par faction ou clan. Les MJ voient en plus les notes et les PNJ liés. |
| `/pnj montrer` (MJ) | Affiche un PNJ à la table et monte sa Visibilité dans Notion (`photo_seule` : nom et portrait uniquement). |
| `/pnj sync` (MJ) | Recharge immédiatement les PNJ et les séances depuis Notion. |
| `/lore` | Lore par catégorie. |
| `/session derniere` · `voir` · `liste` | Résumés des séances (base Notion « Séances (Vampire) »). Les MJ reçoivent en plus les notes 🔒. |
| `/mj` (Super MJ) | Donner ou retirer les droits MJ. |

## PNJ depuis Notion

Les PNJ viennent de la base Notion **Personnages** (lignes dont `Type` = PNJ), synchronisée au démarrage puis toutes les `NOTION_SYNC_MINUTES` minutes.

| Notion | Bot |
|---|---|
| `Nom` | Nom (emoji et gras retirés : « 💀 **Cassandra** » → « Cassandra ») |
| `Clan`, `Affiliation`, `Rang`, `Statut` | Infos de la fiche |
| `Description publique` | Texte montré aux joueurs |
| `Visibilité` | **Caché** : invisible pour les joueurs · **Photo seule** : nom et portrait · **Complet** : toute la fiche publique (vide = Caché) |
| Première image de la page | Portrait (téléchargé par le bot, les liens Notion expirent) |
| Contenu de la page | **Notes MJ**, visibles uniquement des MJ ; les PNJ mentionnés deviennent des boutons de lien |

Mise en place :
1. Créer une intégration sur https://www.notion.so/my-integrations (capacités : lire et mettre à jour le contenu) et copier son token dans `NOTION_TOKEN`.
2. Dans Notion, sur la base Personnages : `•••` → **Connexions** → ajouter l'intégration.
3. `NOTION_DATABASE_ID` = l'identifiant de la base (dans son URL).

Sans ces variables, le bot utilise la dernière copie de `pnj.json`.


## Séances depuis Notion

Les séances viennent de la base Notion **Séances (Vampire)**, créée et remplie par le Codex : dans le mode Session, onglet Bilan, « Clore la séance » écrit une page par séance. Le bot la retrouve par son titre (ou via `NOTION_SESSIONS_DATABASE_ID`) et la synchronise avec les PNJ.

Le haut de la page est le résumé lu par les joueurs ; la section `## 🔒 MJ` (et tout bloc qui commence par 🔒) n'est montrée qu'aux MJ, en privé.

## Données

- `src/data/rules.json`, `lore.json`, `memo.json` : contenu de référence, versionné. Modifier puis redémarrer le bot.
- `pnj.json` : copie locale des PNJ Notion (réécrite à chaque synchronisation), portraits dans `portraits/`.
- `sessions.json` : copie locale des séances Notion.
- `config.json` : données de campagne, modifiées par le bot.
  Elles sont lues et écrites dans `DATA_DIR` (par défaut `src/data`). Au premier lancement, si un fichier manque dans `DATA_DIR`, il est copié depuis `src/data`.

## Lancer en local

```sh
cp .env.example .env   # puis remplir les valeurs
yarn install
yarn dev
```

Les commandes slash sont redéployées sur le serveur (`GUILD_ID`) à chaque démarrage.

## Héberger

Le bot garde une connexion ouverte avec Discord : il lui faut un processus qui tourne en continu (pas de serverless).

Il tourne sur le VPS, avec pm2 :
```sh
yarn install && yarn build
DATA_DIR=/var/lib/vtm pm2 start dist/index.js --name vtm
```
Mettre à jour : `git pull && yarn install && yarn build && pm2 restart vtm`. Logs : `pm2 logs vtm`.
Garder `DATA_DIR` hors du dépôt évite les conflits avec `git pull`.
