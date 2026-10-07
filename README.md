# VTM — compagnon de session

Bot Discord pour une campagne de *Vampire : la Mascarade* (V5) : règles à portée de main, mémos de table, fiches de PNJ avec portrait, lieux et journal de campagne.

## Commandes

| Commande | Usage |
|---|---|
| `/regle [recherche] [public]` | Recherche une règle ou une Discipline (autocomplétion, insensible aux accents). Sans argument : sommaire navigable. Réponse privée avec bouton « Montrer à la table ». |
| `/memo [fiche] [public]` | Fiches de synthèse : jets, combat, Soif & Frénésie, Volonté & social. |
| `/pnj voir` · `liste` | Fiche avec portrait ; galerie filtrable par faction ou clan. Les MJ voient en plus les notes et les PNJ liés. |
| `/pnj montrer` (MJ) | Affiche un PNJ à la table (option `photo_seule`) et coche « Connu » dans Notion. |
| `/pnj sync` (MJ) | Recharge immédiatement les PNJ depuis Notion. |
| `/lore` | Lore par catégorie. |
| `/lieu` | Lieux de la campagne. |
| `/session` | Journal des sessions. |
| `/mj` (Super MJ) | Donner ou retirer les droits MJ. |

## PNJ depuis Notion

Les PNJ viennent de la base Notion **Personnages** (lignes dont `Type` = PNJ), synchronisée au démarrage puis toutes les `NOTION_SYNC_MINUTES` minutes.

| Notion | Bot |
|---|---|
| `Nom` | Nom (emoji et gras retirés : « 💀 **Cassandra** » → « Cassandra ») |
| `Clan`, `Affiliation`, `Rang`, `Statut` | Infos de la fiche |
| `Description publique` | Texte montré aux joueurs |
| `Connu` | Décoché = invisible pour les joueurs |
| Première image de la page | Portrait (téléchargé par le bot, les liens Notion expirent) |
| Contenu de la page | **Notes MJ**, visibles uniquement des MJ ; les PNJ mentionnés deviennent des boutons de lien |

Mise en place :
1. Créer une intégration sur https://www.notion.so/my-integrations (capacités : lire et mettre à jour le contenu) et copier son token dans `NOTION_TOKEN`.
2. Dans Notion, sur la base Personnages : `•••` → **Connexions** → ajouter l'intégration.
3. `NOTION_DATABASE_ID` = l'identifiant de la base (dans son URL).

Sans ces variables, le bot utilise la dernière copie de `pnj.json`.

## Données

- `src/data/rules.json`, `lore.json`, `memo.json` : contenu de référence, versionné. Modifier puis redémarrer le bot.
- `pnj.json` : copie locale des PNJ Notion (réécrite à chaque synchronisation), portraits dans `portraits/`.
- `lieux.json`, `sessions.json`, `config.json` : données de campagne, modifiées par le bot.
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

**Railway**
1. Créer un service depuis le dépôt GitHub. Railway lance `yarn build` puis `yarn start`.
2. Ajouter les variables `BOT_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `SUPER_MJ_ID`.
3. Ajouter un **volume** monté sur `/data` et définir `DATA_DIR=/data`, sinon les PNJ ajoutés en jeu sont perdus à chaque redéploiement.

**VPS**
```sh
yarn install && yarn build
DATA_DIR=/var/lib/vtm pm2 start dist/index.js --name vtm
```
Garder `DATA_DIR` hors du dépôt évite les conflits avec `git pull`.
