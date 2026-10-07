# VTM — compagnon de session

Bot Discord pour une campagne de *Vampire : la Mascarade* (V5) : règles à portée de main, mémos de table, fiches de PNJ avec portrait, lieux et journal de campagne.

## Commandes

| Commande | Usage |
|---|---|
| `/regle [recherche] [public]` | Recherche une règle ou une Discipline (autocomplétion, insensible aux accents). Sans argument : sommaire navigable. Réponse privée avec bouton « Montrer à la table ». |
| `/memo [fiche] [public]` | Fiches de synthèse : jets, combat, Soif & Frénésie, Volonté & social. |
| `/pnj voir` · `liste` | Fiche avec portrait, relations cliquables ; galerie filtrable par faction ou clan. |
| `/pnj montrer` (MJ) | Affiche un PNJ à la table (option `photo_seule`) et le rend connu des joueurs. |
| `/pnj ajouter` · `modifier` · `secret` · `supprimer` (MJ) | Gestion des PNJ. Un PNJ ajouté est **inconnu des joueurs** par défaut. |
| `/lore` | Lore par catégorie. |
| `/lieu` | Lieux de la campagne. |
| `/session` | Journal des sessions. |
| `/mj` (Super MJ) | Donner ou retirer les droits MJ. |

## Données

- `src/data/rules.json`, `lore.json`, `memo.json` : contenu de référence, versionné. Modifier puis redémarrer le bot.
- `pnj.json`, `lieux.json`, `sessions.json`, `config.json` : données de campagne, modifiées par le bot.
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
