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

## Chiffrage et visites

- `shared/calc.js` : `chiffrageChantier` (prix, temps de toutes les tâches, matériaux fourni-posé), `aideChiffrage` (fourchettes ajustées, majorations plafonnées à +100 %, rentabilité, prix au temps passé, alertes), `referencePrix` (valeurs par défaut fusionnées avec `parametres.prixRef`). Tests dans `~/3L-Carrelage-ERP/test/calc.test.js` (copier `calc.js` là-bas puis `npm test`).
- PDF = vrais fichiers créés avec jsPDF 2.5.1 (`js/vendor/jspdf.umd.min.js`, copie de cdnjs, sha256 98ccf17a…, mis en cache par le service worker). `js/pdf.js` : mise en page (`nouveauPdf` : en-tête, encadrés, tableaux, photos 4:3 lues dans IndexedDB, signatures, numéros de page ; `clean()` retire les caractères hors WinAnsi), `proposerPdf` (iPhone : partage / Enregistrer dans Fichiers ; Mac : téléchargement ; bouton Ouvrir). L'impression navigateur ne marche pas dans l'app installée : ne pas revenir à `window.print()`.
- `js/docs.js` : `pdfDossierChantier` (bouton « Dossier PDF » d'un chantier) : fiche, visite d'origine, montant et devis (droit `ca`), tâches, journal, heures, photos par phase (2/3/4 par ligne), PV de réception à signer (coché par défaut si terminé).
- `js/devis.js` : bouton « Devis PDF » du calculateur. `lignesDevis(v, r)` rédige les prestations (pose, faïence, préparation, étanchéité, plinthes, marches, douche, gravats, déplacement, fournitures avec marge) selon qui fournit carrelage et produits ; aperçu modifiable (textes, qté, unité, PU, lignes) puis fichier PDF via `js/pdf.js`. Rien n'est enregistré.
- `js/views/outils.js` : calculateur (indicateurs sous les prix, « Remplir les prix conseillés », « Réinitialiser », pré-remplissage depuis une visite `#/outils?visite=<id>`).
- `js/views/visites.js` : type `visite` (client, pièces avec mesures et travaux, situation, notes) ; photos = type `photo` avec `visiteId` (+ `pieceId`). « Créer le chantier » crée client + chantier prospect + note et rattache les photos (`chantierId`).
- `produitsFourni === 'client'` (calculateur et visite) : colle et joint non achetés, ragréage / chape / étanchéité / profilés en pose seule (`poseMin`/`poseMax`, `prestationEffective`).
- Estimation basse / moyenne / haute d'une visite : `estimationVisite(vis, ref)` dans `shared/calc.js`. Chaque pièce : travaux cochés × fourchettes, majorées selon la situation de la visite + réglages de la pièce (`formatL/H`, `piece` auto via `typePieceAuto`, `difficulte`, `obstacles`, `acces` = `SIT_PIECE`). Carrelage compté si `carrelageFourni === 'entreprise'`, colle + joint sauf si `produitsFourni === 'client'`. Affichée dans la visite (droit `ca` ≥ 1), mise à jour en direct, et dans la liste des visites.

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
