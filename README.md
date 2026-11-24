# Cami

Cami est un IDE de bureau en cours de création, conçu pour offrir une expérience de développement inspirée des éditeurs modernes comme VS Code. Il est construit avec Electron, React, TypeScript et Monaco Editor.

> **État du projet :** prototype fonctionnel en évolution. Plusieurs fonctions centrales d’un IDE sont déjà présentes, mais Cami n’a pas encore la parité avec un IDE mature. Les fonctions décrites ci-dessous reflètent le code du dépôt, pas une promesse de compatibilité complète.

**Dernière mise à jour :** 15 novembre 2026

## Sommaire

- [Fonctionnalités disponibles](#fonctionnalités-disponibles)
- [Langages et outils externes](#langages-et-outils-externes)
- [Ce qui manque pour un IDE complet](#ce-qui-manque-pour-un-ide-complet)
- [Technologies et architecture](#technologies-et-architecture)
- [Prérequis](#prérequis)
- [Installation et développement](#installation-et-développement)
- [Dépannage de Gole et DeepSeek](#dépannage-de-gole-et-deepseek)
- [Mesure des performances](#mesure-des-performances)
- [Configuration d’un espace de travail](#configuration-dun-espace-de-travail)
- [Raccourcis](#raccourcis)
- [Sécurité et limites connues](#sécurité-et-limites-connues)
- [Feuille de route](#feuille-de-route)
- [Maintenir cette documentation](#maintenir-cette-documentation)

## Fonctionnalités disponibles

### Édition

- Éditeur Monaco, thème sombre, coloration syntaxique et workers dédiés.
- Onglets, fichiers modifiés non enregistrés, sauvegarde individuelle ou globale.
- Deux panneaux d’édition, déplacement entre les fichiers ouverts et restauration d’une session.
- Explorateur de fichiers avec création, renommage et suppression vers la corbeille.
- Ouverture rapide de fichiers et recherche textuelle dans l’espace de travail.
- Chargement différé de Monaco, des services LSP et des panneaux lourds jusqu’à leur première utilisation.
- Réglages persistants : taille de police, tabulations, retour à la ligne, minimap, numéros de ligne absolus/relatifs/masqués, ligatures, coloration des paires, défilement épinglé et taille de police du terminal.
- Icônes de langages dans les onglets, l’explorateur, la palette de fichiers et la barre d’état (C, C++, CSS, Docker, Go, HTML, JavaScript, JSON, PHP, Python, Ruby, Rust, TypeScript et YAML), avec une icône générique pour les autres fichiers.
- Fermeture groupée des onglets et indicateur visuel et accessible des fichiers modifiés.

### Développement

- Terminal intégré basé sur xterm.js et node-pty.
- Lancement de Gole avec choix persistant du navigateur (Cami/WebKit, Chromium, Firefox, Brave, LibreWolf ou Tor Browser) et du fournisseur IA (DeepSeek ou Gemini). Les navigateurs externes doivent être disponibles sur le système.
- Chat Gole intégré à la barre latérale : état d’exécution, appels d’outils et réponses visibles dans Cami ; les changements de fichiers sont repris par l’explorateur et l’éditeur.
- Gole reçoit la consigne d’écrire en français et en anglais, côte à côte, les commentaires et docstrings qu’il ajoute ou modifie ; il doit éviter les commentaires inutiles. C’est une instruction au modèle, pas une garantie mécanique.
- Vue Git : état du dépôt, diff, staging, commit et changement de branche.
- Tâches issues des scripts `package.json` ou de fichiers `tasks.json`.
- Exécution directe de certains fichiers : JavaScript, TypeScript (si `tsx` ou `ts-node` est installé), Python, Go, Ruby, PHP et scripts shell.
- Débogueur Node.js et prise en charge d’adaptateurs compatibles avec le protocole DAP, selon leur configuration.
- Intégration Language Server Protocol (LSP) : diagnostics, complétion, navigation, symboles, renommage et formatage, selon le serveur utilisé.
- Palette de commandes, symboles, tâches et configurations de débogage.

### Langages

Monaco reconnaît déjà un ensemble de langages pour la coloration syntaxique. Cela ne signifie pas que chaque langage dispose automatiquement de diagnostics, de complétion ou d’un débogueur.

| Langage | Édition / coloration | Outils de langage |
|---|---|---|
| C | Oui (`.c`, `.h`) | `clangd` externe |
| C++ | Oui (`.cc`, `.cpp`, `.cxx`, `.hpp`) | `clangd` externe |
| Rust | Oui (`.rs`) | `rust-analyzer` externe |
| JavaScript / TypeScript | Oui | Services intégrés à Monaco et options LSP |
| Python, Go, PHP, Ruby | Oui | Serveur LSP externe pris en charge |
| CSS, HTML, JSON, YAML, Shell, Dockerfile, et autres | Selon l’extension | Certains serveurs intégrés, ou configuration LSP personnalisée |

**C, C++ et Rust sont donc déjà reconnus par Cami.** Les serveurs `clangd` et `rust-analyzer` ne sont pas fournis par Cami : ils doivent être installés séparément et disponibles dans le `PATH`. L’exécution directe d’un fichier C, C++ ou Rust n’est pas encore proposée par le bouton d’exécution automatique ; utilisez une tâche de workspace ou le terminal. Le débogage de ces langages nécessite une configuration d’adaptateur DAP compatible.

## Ce qui manque pour un IDE complet

Les éléments suivants sont des besoins identifiés, pas des fonctionnalités actuellement garanties :

- Étendre les tests automatisés au-delà de Gole : composants Cami, IPC, système de fichiers, processus et scénarios d’intégration.
- Installation, activation, désactivation et mise à jour d’extensions depuis une interface dédiée.
- Un système clair de confiance par workspace avant le lancement de tâches ou de serveurs configurés par le projet.
- Des workflows intégrés et testés de compilation, exécution et débogage pour C, C++, Rust et d’autres langages.
- Des fonctions Git plus avancées : pull, push, résolution de conflits et historique visuel complet.
- Des préférences persistantes plus étendues, des thèmes configurables et des paramètres par workspace.
- Une expérience de recherche et d’indexation validée sur de très grands dépôts.
- Des mesures reproductibles du temps de démarrage et de la consommation mémoire sur les plateformes prises en charge.
- Une stratégie de mises à jour, de signature et de publication avec documentation utilisateur.
- L’accessibilité, la localisation et les tests de compatibilité à compléter.

## Technologies et architecture

- **Application desktop :** Electron
- **Interface :** React 19 et TypeScript strict
- **Éditeur :** Monaco Editor
- **Terminal :** xterm.js et node-pty
- **État de l’interface :** Zustand
- **Build :** Vite et vite-plugin-electron
- **Distribution :** electron-builder

```text
cami/
├── src/
│   ├── main/         # Fenêtre Electron, IPC, fichiers, Git, tâches, LSP, débogage
│   ├── preload/      # API typée et limitée exposée à l’interface
│   └── renderer/     # Interface React, Monaco et état applicatif
├── gole/             # Agent Gole intégré et son navigateur compagnon C++
├── native/
│   └── webkit-browser/ # Navigateur GTK/WebKit réparti en modules C++
├── scripts/          # Tests, build et création du paquet DEB
├── index.html
├── vite.config.ts
├── electron-builder.yml
└── package.json
```

Le renderer n’accède pas directement aux API Node.js : les opérations passent par le preload et des handlers IPC du processus principal. La fenêtre active `contextIsolation`, `sandbox` et `webSecurity`, et désactive `nodeIntegration`.

## Prérequis

- Node.js **22.12 ou plus récent** (voir `engines` dans `package.json`).
- npm.
- Les dépendances natives nécessaires à `node-pty` sur le système de développement.
- Pour lancer Gole dans Cami sous Linux : GTK 3, WebKitGTK 4.1, JSON-GLib, CMake et Ninja. Gole se trouve dans `cami/gole`. `../install-cami-gole-deps.sh --npm-only` installe les dépendances npm et compile le navigateur natif. `CAMI_GOLE_ENTRY` et `GOLE_WEBKIT_BINARY` permettent de configurer des chemins personnalisés.
- Pour les fonctions de langage, les outils correspondants installés séparément : par exemple `clangd` pour C/C++ et `rust-analyzer` pour Rust.

## Installation et développement

Depuis le dossier `cami` :

```bash
npm ci
npm run dev
```

Dans le panneau **Gole**, choisissez un navigateur et un fournisseur IA, puis cliquez sur **Appliquer** avant d’envoyer un message. Le choix est enregistré dans les données utilisateur de Cami. Par défaut, Gole utilise **Navigateur Cami** (WebKitGTK, Linux uniquement) et **DeepSeek**. Chromium, Firefox, Brave, LibreWolf et Tor Browser nécessitent que le navigateur choisi soit installé et disponible ; leurs fenêtres ne sont pas positionnées par Cami. Gemini est également disponible, sous réserve d’une connexion valide chez Google. Gole et le navigateur Cami/WebKit sont inclus dans le paquet Linux ; le paquet utilise le runtime Node embarqué par Electron. Les données de Gole sont stockées dans le dossier utilisateur de Cami ; au premier lancement, les fichiers de `~/.gole` sont copiés sans écraser les données déjà présentes. L’ancien dossier n’est pas supprimé. Le profil du navigateur conserve localement les cookies et les données de site, mais Cami ne mémorise ni ne stocke les mots de passe et ne peut garantir qu’un fournisseur conservera une session valide. Consultez la section [Dépannage de Gole et DeepSeek](#dépannage-de-gole-et-deepseek) en cas de demande de reconnexion. Gole garde l’accès à ses outils locaux de fichiers et de commandes ; ne le lancez que dans un workspace de confiance.

Le chat Gole est aussi disponible avec l’icône robot de la barre d’activité. Ouvrez d’abord un workspace, puis envoyez un message : Cami démarre Gole en arrière-plan avec ce workspace et affiche les étapes d’outils et la réponse. Les fichiers modifiés sont détectés par le watcher de Cami ; les buffers propres déjà ouverts sont rechargés, tandis que les buffers non enregistrés sont conservés et un avertissement est ajouté à la vue Sortie en cas de conflit. Les commandes de Gole s’exécutent dans son propre processus (elles ne sont pas saisies dans le terminal xterm de Cami), mais leurs résultats sont également ajoutés à Sortie. Avec **Navigateur Cami**, le navigateur C++/WebKitGTK s’ouvre dans une fenêtre GTK séparée, positionnée près de Cami (à droite si l’espace le permet, sinon à gauche). Le gestionnaire de fenêtres peut ajuster cette position, notamment sous Wayland ; la fenêtre reste déplaçable.

Le serveur Vite de développement utilise `127.0.0.1:5173`.

Commandes disponibles :

```bash
npm run typecheck  # Vérification TypeScript
npm run build      # Vérification TypeScript puis builds renderer, main et preload
npm test           # Vérification TypeScript et tests de Gole
npm run native:build # Compilation du navigateur C++/GTK/WebKit
npm run dist       # Build et création des installateurs
npm run dist:dir   # Build et création d’une application non installée
./scripts/test.sh      # Tests automatisés
./scripts/build.sh     # Navigateur natif et application
./scripts/build-deb.sh # Création et vérification du paquet .deb Linux
```

La configuration electron-builder prévoit des cibles Windows (NSIS), macOS (DMG et ZIP) et Linux (AppImage et DEB), en x64 et arm64. La création de paquets dépend de l’OS hôte, des outils natifs et de la disponibilité des binaires précompilés ; les cibles doivent être vérifiées sur les plateformes de publication.

## Dépannage de Gole et DeepSeek

### Gole redemande une connexion pendant une analyse

Une demande de reconnexion peut signaler une session expirée, mais aussi un problème côté fournisseur. Dans les captures examinées le 15 novembre 2026, DeepSeek affichait que le compte était suspendu jusqu’au **18 novembre 2026 à 19:15** (le fuseau horaire n’était pas indiqué). La page de suspension ne présentait pas de formulaire de connexion : elle pouvait donc être prise à tort pour un problème de session ou de saisie du message.

Cami détecte maintenant le message de suspension et l’affiche comme tel, au démarrage comme pendant la récupération d’une session. Il ne peut ni lever la suspension ni confirmer que le compte est de nouveau autorisé : seul DeepSeek peut le faire. Contactez le fournisseur ou attendez la fin annoncée. Réinstaller Cami, effacer les cookies ou enregistrer le mot de passe dans Cami ne lève pas une suspension et peut faire perdre des données de session.

### Rétablir et vérifier le fonctionnement

1. Vérifiez que DeepSeek a effectivement levé la suspension. Si le fournisseur affiche encore ce message, la reconnexion dans Cami ne peut pas résoudre le problème.
2. Lancez une version de Cami qui contient le diagnostic de suspension. Ouvrez le navigateur compagnon et reconnectez-vous uniquement si DeepSeek affiche une page de connexion normale.
3. Envoyez d’abord un court message sans effet sur vos fichiers, puis fermez et relancez Cami pour vérifier que la session du profil WebKit est toujours disponible.
4. Lancez ensuite une petite analyse de dossier. Si une reconnexion normale survient, reconnectez-vous dans le navigateur compagnon ; Gole reprend le message interrompu. Il ne rejoue pas les actions d’outils déjà terminées.
5. Si le problème revient, notez le texte exact affiché par DeepSeek et par Gole. Une nouvelle mention de suspension doit être traitée par DeepSeek ; une page de connexion sans suspension correspond à une session expirée ; une autre erreur nécessite d’examiner les journaux de Gole et la version de Cami.

Les cookies et données de site sont conservés dans le profil WebKit de Cami, sous réserve des règles du fournisseur, de l’expiration de la session et des paramètres du compte. Les mots de passe ne sont pas enregistrés par Cami. Cette séparation est intentionnelle : la persistance du profil aide à retrouver une session, mais ne garantit ni la connexion permanente ni la réactivation d’un compte suspendu.

## Mesure des performances

Lors d’une mesure locale sous Linux, avec un workspace restauré mais sans fichier éditeur ouvert, le chargement différé a donné les résultats suivants :

| Mesure | Avant | Après |
|---|---:|---:|
| Bundle JavaScript d’entrée, non compressé | 4 720 241 octets | 323 621 octets |
| Heap JavaScript utilisé par le renderer | 18 160 508 octets | 9 604 728 octets |
| RSS du renderer | 244 804 KiB | 139 440 KiB |

Sur cette comparaison ponctuelle, le bundle d’entrée baisse d’environ 93 %, le heap de 47 % et le RSS du renderer de 43 %. Ce n’est pas encore un benchmark reproductible : les valeurs dépendent de la machine et ne mesurent pas l’édition d’un fichier. Les principales fonctions Monaco sont désormais chargées à la demande ; le chunk Monaco dédié reste volumineux (environ 2,74 Mo non compressé). La consommation mémoire lors de l’édition, avec LSP et workers actifs, reste à mesurer.

## Configuration d’un espace de travail

Cami accepte des tâches dans `.cami/tasks.json` ou `.vscode/tasks.json`. Exemple de tâche pour compiler un fichier Rust :

```json
{
  "tasks": [
    {
      "label": "Compiler le projet Rust",
      "type": "process",
      "command": "cargo",
      "args": ["build"],
      "options": {
        "cwd": "${workspaceFolder}"
      },
      "group": "build"
    }
  ]
}
```

Les commandes de tâches exécutent des programmes du système dans le dossier du workspace. Pour C ou C++, configurez de la même façon `cmake`, `ninja`, `make` ou le compilateur de votre choix.

Les serveurs LSP personnalisés peuvent être déclarés dans `.cami/language-servers.json` :

```json
{
  "servers": [
    {
      "id": "clangd-custom",
      "label": "clangd",
      "languages": ["c", "cpp"],
      "command": "clangd",
      "args": []
    }
  ]
}
```

Les configurations de lancement et de débogage sont lues depuis `.cami/launch.json` ou `.vscode/launch.json`. La prise en charge dépend du type de configuration et de la présence de l’exécutable ou de l’adaptateur concerné.

## Raccourcis

Les raccourcis utilisent `Ctrl` sous Windows/Linux et `⌘` sous macOS, sauf indication contraire.

| Raccourci | Action |
|---|---|
| `Ctrl/⌘+P` | Ouvrir rapidement un fichier |
| `Ctrl/⌘+Shift+P` | Palette de commandes |
| `Ctrl/⌘+O` | Ouvrir un dossier |
| `Ctrl/⌘+N` | Nouveau fichier |
| `Ctrl/⌘+Shift+N` | Nouveau dossier |
| `Ctrl/⌘+S` | Enregistrer |
| `Ctrl/⌘+Alt+S` | Tout enregistrer |
| `Ctrl/⌘+W` | Fermer l’onglet actif |
| `Ctrl/⌘+Shift+F` | Recherche |
| `Ctrl/⌘+B` | Afficher/masquer la barre latérale |
| `Ctrl/⌘+J` | Afficher/masquer le panneau inférieur |
| `Ctrl/⌘+\`` | Afficher/masquer le terminal |
| `F5` | Démarrer ou continuer le débogage |
| `Shift+F5` | Arrêter le débogage |
| `F9` | Ajouter/retirer un point d’arrêt |
| `F10` / `F11` / `Shift+F11` | Pas à pas / entrer / sortir |

Les raccourcis indiqués sont ceux déclarés par l’application ; certains peuvent dépendre du focus ou du système.
Les barres latérales et le panneau inférieur peuvent aussi être redimensionnés par glisser-déposer ; leurs tailles et leur visibilité sont enregistrées localement.

## Sécurité et limites connues

- Les tâches, compilateurs, serveurs LSP et adaptateurs DAP configurés par un workspace peuvent lancer des processus locaux. N’ouvrez et n’exécutez que des projets auxquels vous faites confiance.
- Les opérations de lecture et d’écriture de fichiers sont limitées au workspace et les liens symboliques sont résolus avant l’accès.
- Le terminal intégré donne accès au shell de l’utilisateur : il a volontairement les capacités du compte qui exécute Cami.
- Le chat Gole peut lire et modifier les fichiers et exécuter des commandes locales avec les droits de l’utilisateur. N’envoyez pas d’informations sensibles à un fournisseur IA et ne l’utilisez que dans un workspace de confiance.
- Les intégrations IA sélectionnables dans le panneau Cami sont celles qui sont implémentées et testées (DeepSeek et Gemini). HackerAI, Venice et Mistral sont encore des adaptateurs incomplets dans Gole et ne sont donc pas proposés comme choix fonctionnels.
- Les serveurs de langage externes ont leurs propres dépendances, consommation mémoire et niveau de sécurité ; Cami ne les inclut pas dans ses installateurs.
- Le build signale encore des chunks volumineux associés à Monaco ; l’impact sur la mémoire une fois un fichier ouvert reste à mesurer.
- `npm test` vérifie TypeScript et exécute les tests de Gole ; une couverture automatisée plus large des composants de Cami et des scénarios d’intégration reste à ajouter.

## Feuille de route

Cette liste décrit des axes de travail ; elle ne constitue pas un engagement de livraison.

1. Ajouter des tests automatisés aux composants critiques (IPC, système de fichiers, tâches et processus).
2. Mettre en place une confirmation de confiance avant l’exécution initiale des outils d’un workspace.
3. Rendre reproductibles les mesures de mémoire et de démarrage, puis profiler de grands espaces de travail et les plateformes prises en charge.
4. Réduire progressivement le coût des chunks Monaco et mesurer l’usage mémoire avec un fichier et un serveur de langage actifs.
5. Compléter les workflows de compilation, d’exécution et de débogage C/C++/Rust et les documenter.
6. Évaluer une implémentation native en Rust uniquement pour un composant identifié comme coûteux par profilage. Un module Rust isolé ne réduit pas, à lui seul, la mémoire de base d’Electron et peut même l’augmenter s’il ajoute un processus.
7. Ajouter progressivement les fonctions attendues d’un IDE de production (extensions, Git avancé, accessibilité, distribution et mises à jour).

## Maintenir cette documentation

À chaque changement visible par l’utilisateur, mettre à jour dans ce README les fonctionnalités, les prérequis, les commandes, les configurations et les limites concernées. Distinguer les fonctions disponibles, celles qui dépendent d’outils externes et celles qui restent à faire. Mettre également à jour la date en tête du document.
