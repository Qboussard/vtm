# VTM — compagnon de session

Bot Discord pour une campagne de *Vampire : la Mascarade* (V5) : règles à portée de main, mémos de table, fiches de PNJ avec portrait et journal de campagne.

## Commandes

| Commande | Usage |
|---|---|
| `/jet [attribut] [competence] [reserve] [bonus] [difficulte] [soif] [raison]` | Lance les dés V5 depuis votre fiche : réserve calculée, dés de Soif selon votre Soif, réussites critiques, messianiques, échecs bestiaux. Bouton « Relancer 3 dés (Volonté) » qui coche la Volonté sur la fiche. |
| `/exaltation [nombre] [raison]` | Test d'Exaltation : la Soif de votre fiche monte sur un 1 à 5. |
| `/fiche [nom] [clan] [joueur]` | Crée votre fiche (avec `nom:` et `clan:`) dans un **fil privé** (vous + les MJ), ou l'ouvre. Tout le reste se fait depuis la fiche. Les MJ visent un joueur avec `joueur:`. |
| `/regle [recherche] [public]` | Recherche une règle ou une Discipline (autocomplétion, insensible aux accents). Sans argument : sommaire navigable. Réponse privée avec bouton « Montrer à la table ». |
| `/discipline [pouvoir] [discipline] [clan] [niveau] [public]` | Pouvoirs des Disciplines avec catégorie (Animalisme, Auspex, Oblivion…), coût, jet et jet contre. Sans argument : liste des Disciplines ; `discipline:` et `niveau:` filtrent la liste, `clan:` liste les trois Disciplines du clan (Ventru → Domination, Force d'âme, Présence), `pouvoir:` ouvre une fiche (autocomplétion). |
| `/memo [fiche] [public]` | Fiches de synthèse : jets, combat, Soif & Frénésie, Volonté & social. |
| `/pnj voir` · `liste` | Fiche avec portrait ; galerie filtrable par faction ou clan. Les MJ voient en plus les notes et les PNJ liés. |
| `/pnj montrer` (MJ) | Affiche un PNJ à la table et monte sa Visibilité dans Notion (`photo_seule` : nom et portrait uniquement). |
| `/pnj sync` (MJ) | Recharge immédiatement les PNJ et les séances depuis Notion. |
| `/session derniere` · `voir` · `liste` | Résumés des séances (base Notion « Séances (Vampire) »). Les MJ reçoivent en plus les notes 🔒. |
| `/mj` (Super MJ) | Donner ou retirer les droits MJ. |

## Fiches et jets

Chaque fiche appartient à un compte Discord : `/jet`, `/exaltation` et le bouton « Lancer » des pouvoirs (`/discipline`) lisent la fiche de celui qui les utilise.

1. Dans un salon textuel (de préférence le salon de jeu), `/fiche nom: clan:` crée la fiche et un fil privé où ne sont invités que le joueur et les MJ. Un MJ peut créer la fiche d'un joueur avec `joueur:`. Plus tard, `/fiche` seul renvoie vers le fil (et le recrée s'il a été supprimé).
2. Sous la fiche, tout se gère sans commande, par le joueur ou un MJ :
   - **✏️ Modifier une valeur** : attributs, compétences, Disciplines, Soif, Humanité, Taches, Puissance du sang, Génération (attributs à 1, compétences à 0 au départ) ;
   - **🩸 Test d'Exaltation** ;
   - **💔 Dégâts et soins** : une case par clic, Santé ou Volonté, superficiel ou aggravé ;
   - **🪪 Nom et clan** ;
   - **🔗 Joueur (MJ)** : rattache la fiche à un autre compte Discord, dont les jets utiliseront alors cette fiche.
3. La fiche épinglée dans le fil est **modifiée** à chaque changement (jet de Volonté, Exaltation, dégâts…), et chaque changement y est noté. Sur ordinateur, le fil s'ouvre à côté du salon : la fiche reste visible pendant la partie.

Santé = Vigueur + 3 (+ Force d'âme), Volonté = Sang-froid + Résolution. Une piste pleine affiche « Affaibli » ; un dégât sur une piste pleine transforme une case superficielle en aggravée.

Permissions du bot dans le salon des fiches : *Créer des fils privés*, *Envoyer des messages dans les fils*, *Gérer les fils* (renommer, désarchiver) et *Gérer les messages* (épingler la fiche).

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

- `src/data/rules.json`, `memo.json`, `clans.json` (Disciplines de clan), `disciplines.json` (pouvoirs : niveau, nom, VO, coût, jet, jet contre, description, amalgame) : contenu de référence, versionné. Modifier puis redémarrer le bot.
- `pnj.json` : copie locale des PNJ Notion (réécrite à chaque synchronisation), portraits dans `portraits/`.
- `sessions.json` : copie locale des séances Notion.
- `fiches.json` : fiches des PJ, par identifiant Discord du joueur.
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
