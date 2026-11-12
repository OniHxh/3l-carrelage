# 3L Carrelage — contexte pour Claude

Application de suivi des chantiers de l'entreprise 3L Carrelage (chantiers, photos, journal, tâches, heures, planning, clients, équipe, devis importés, chiffre d'affaires, calculateur). Interface 100 % en français.
En ligne : https://onihxh.github.io/3l-carrelage/ · Dépôt : https://github.com/OniHxh/3l-carrelage (public, branche `main`, GitHub Pages à la racine).

Remplace l'ancienne version serveur (Node.js + SQLite sur le MacBook, publiée via Tailscale) qui reste archivée dans `~/3L-Carrelage-ERP` (ne plus la lancer, sauf pour réexporter : `node server/export-pour-web.js`).

## Règles de travail (à respecter à chaque session)

- **Ne jamais effacer les données de l'utilisateur.** Elles vivent dans IndexedDB (`3l-local`) sur son téléphone et son Mac, pas dans le dépôt. Toute évolution du format doit rester compatible ; `local.merge()` n'efface jamais rien.
- **Avant chaque publication (`git push`)** : prévenir l'utilisateur pour qu'il fasse « Exporter tout » (Paramètres → Données & appareil), attendre son feu vert, puis pousser.
- Après le push : attendre ~50 s, vérifier le site en ligne avec `curl` (grep d'une fonction nouvelle + version du cache dans `sw.js`).
- À chaque mise à jour publiée, incrémenter `CACHE='3l-vN'` dans `sw.js` (et ajouter tout nouveau fichier à `SHELL`).
- Tester dans le navigateur intégré, servi sous un sous-dossier (`/3l-carrelage/`, comme GitHub Pages) : téléphone (375×812) et grand écran, console sans erreur, avec des données factices (jamais les vraies).
- Le dépôt est **public** : ne jamais y mettre de données réelles, de clé GitHub, d'e-mail ou d'info perso.
- Chemins **relatifs** partout (pas de `/js/…`) : le site est servi sous `/3l-carrelage/`.
- L'utilisateur n'est pas développeur : expliquer simplement, en étapes courtes.

## Architecture

- PWA statique sans étape de compilation : `index.html`, `css/app.css`, `js/` (modules ES), `shared/` (calculs, permissions, lecture PDF), `sw.js`, `manifest.webmanifest`, `icons/`.
- `js/local.js` : « serveur » dans le navigateur. Traite les routes `/api/...` (`/me`, `/sync`, `/batch`, `/records`, `/audit`, `/users`) sur IndexedDB `3l-local` (stores `records`, `blobs`, `audit`, `meta`). Règles métier reprises de l'ancien serveur : numérotation `CH-AAAA-NNN`, avancement 0–100, journal d'activité avec diff, suppressions logiques.
- `js/core.js` `api()` appelle `local.handle()` (plus de `fetch`). `js/store.js` (cache mémoire + IndexedDB `3l-erp`, file d'envoi) est inchangé dans son principe.
- Photos et devis : stockés comme Blob dans `blobs`, servis par le service worker sous `api/blobs/<id>` ; les liens `a[href^="api/blobs/"]` sont ouverts via un Blob URL (`app.js`).
- Plus de comptes ni de mot de passe : une seule personne (administrateur, `meta.owner`). Les anciens comptes restent dans `meta.users` pour l'affichage des noms. Membres sans compte = type `membre`.
- Premier lancement (base vide) : `js/views/accueil.js` → récupérer via la synchro, importer un fichier, ou démarrer à vide.

## Synchronisation entre appareils (`js/cloud.js`)

- Même modèle que Plan : Gist **privé**, chiffré PBKDF2 (250 000 itérations) + AES-GCM 256. Clé `ghp_…` limitée à `gist`, créée par l'utilisateur lui-même (la clé de Plan, même origine `onihxh.github.io`, est proposée automatiquement).
- Clé et phrase secrète dans `localStorage['3l-sync']`, jamais exportées.
- Fichier `3l-carrelage.json` = fiches + journal (1 500 dernières lignes) + compteurs + comptes + index `packs` (blobId → fichier). Photos/devis dans des paquets immuables `f-….json` (~3 Mo max chacun).
- Fusion fiche par fiche, la plus récente (`_updatedAt`) gagne ; union du journal ; compteurs au max. Un appareil vide ne peut rien écraser.
- Déclenchement : au démarrage, au retour sur l'app, au retour du réseau, toutes les 60 s, et 2,5 s après chaque modification.
- Claude ne doit jamais saisir ni créer la clé GitHub à la place de l'utilisateur.

## Historique

1. Version serveur (Node.js + SQLite + Tailscale) : chantiers, planning, équipe, CA, devis importés, récap planning.
2. Novembre 2026 : passage en application GitHub Pages sans serveur, données sur l'appareil, synchro chiffrée par Gist, import des données de l'ancienne version.
