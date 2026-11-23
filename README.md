# Crew View

Open-space isométrique où chaque agent de votre projet a son bureau et s'anime en temps réel pendant votre session **Claude Code**.

- L'agent principal (votre orchestrateur) occupe le grand bureau du fond.
- Quand il délègue, on le voit se lever et apporter un dossier au bureau de l'agent concerné.
- Chaque agent réfléchit, lit, écrit ou exécute selon ce qu'il fait réellement. Les bulles affichent sa réflexion ou son action, et le voyant de son écran prend la couleur de son statut.
- Les agents intégrés à Claude Code (`Explore`, `general-purpose`…), qui ne sont pas définis dans le projet, arrivent par la porte **Intérim** et s'installent à la table partagée.
- La barre de dialogue en bas reprend votre dernière demande et la réponse de l'orchestrateur.
- Un clic sur un agent ouvre son panneau : tâche, statut, outils, fichiers touchés, tokens et historique.

L'observation est purement passive. Crew View lit les transcripts que Claude Code écrit déjà dans `~/.claude/projects/` : aucun hook à installer, rien à modifier dans vos sessions.

## Installation

### Extension VS Code (recommandé)

```bash
npm install
npm run package          # produit crew-view-0.1.0.vsix
code --install-extension crew-view-0.1.0.vsix
```

Elle fonctionne sous Windows natif comme en WSL (l'extension s'exécute alors côté WSL, là où tourne Claude Code). Node n'est requis que pour construire le `.vsix` : l'extension utilise le Node intégré à VS Code.

Commandes (palette `Ctrl+Shift+P`, préfixe **Crew View**) :

| Commande | Effet |
|---|---|
| Ouvrir l'open-space | Panneau à côté de l'éditeur. Raccourci : `Crew` dans la barre d'état. |
| Ouvrir l'open-space dans le navigateur | Serveur local sur `127.0.0.1:4719` (réglage `crewView.port`) |
| Générer les agents Claude Code depuis les agents Copilot | Voir plus bas |
| Ouvrir la configuration du projet | Ouvre `.crew-view/config.json`, après l'avoir créé s'il n'existe pas |

### Barre latérale Crew

L'icône **Crew** de la barre d'activité (colonne de gauche) ouvre trois vues :

- **Agents** : la liste des agents et leur statut en direct, avec l'activité en cours (fichier lu ou modifié, commande…). Elle reste utile quand l'open-space est caché derrière un éditeur. Un clic sélectionne l'agent ; un second clic le désélectionne.
- **Agent sélectionné** : la fiche de l'agent, en sections repliables :
  - **Rôle** ;
  - **Tâche** (en cours ou dernière, avec les fichiers touchés) ;
  - **Activité** : consommation de l'agent sur la session, puis par demande ;
  - **Historique**.

  L'état replié est mémorisé d'un agent à l'autre et d'une session de VS Code à l'autre. Un clic sur un agent dans l'open-space l'ouvre ici, et la sélection est synchronisée dans les deux sens.
- **Demandes** : la consommation de tokens de la session suivie. On y trouve le total de la session, le coût réel enregistré par Claude Code, puis une entrée par prompt avec son bilan et le détail par agent. Un subagent est compté dans la demande qui l'a lancé, même s'il termine après le prompt suivant.
- **Paramètres** :
  - pour le projet : orchestrateur et dossiers d'agents supplémentaires ;
  - pour chaque agent, intérimaires compris : nom affiché, couleur, accessoire, poste et masquage. Choisir un poste déjà occupé échange les deux agents ;
  - pour VS Code : port du navigateur, dossier Claude et dossier de graphismes commun.

  Les réglages du projet sont écrits dans `.crew-view/config.json` et appliqués à chaud.

En mode navigateur, sans barre latérale, la fiche s'affiche dans un panneau flottant.

### Sans VS Code (CLI)

```bash
npm install && npm run build
node dist/cli.js /chemin/du/projet            # ouvre le navigateur
node dist/cli.js . --port 4800 --no-open
node dist/cli.js . --verbose                 # journal de diagnostic dans la console
node dist/cli.js . --theme-dir ~/mes-graphismes   # dossier de graphismes commun
```

## Où sont cherchés les agents

Dans cet ordre, en fusionnant les doublons (un même agent au format Copilot et au format Claude Code n'apparaît qu'une fois) :

1. les dossiers listés dans `agentsDirs` de `.crew-view/config.json` ;
2. `.claude/agents/` (format Claude Code) ;
3. `.github/agents/*.agent.md` (format GitHub Copilot) ;
4. `.agents/` ;
5. les chemins d'agents cités dans `AGENTS.md`, globs compris (par ex. `` `.github/agents/*.agent.md` ``).

L'orchestrateur est l'agent qui délègue : clé `agents:` ou outil `agent` dans son frontmatter. On peut aussi le désigner avec `orchestrator` dans la configuration. Sans orchestrateur, le grand bureau revient à « Claude », la session principale.

## Agents Copilot → subagents Claude Code

Claude Code ne lit pas les fichiers `.agent.md` de Copilot. Sans conversion, la session principale lit ces fichiers comme de simples consignes et délègue uniquement à ses agents intégrés. La commande **Générer les agents Claude Code** crée un fichier `.claude/agents/<id>.md` pour chaque agent Copilot :

- le nom, la description et le prompt sont conservés ;
- les outils sont traduits : `read` → Read/Glob/Grep, `search` → Grep/Glob, `edit` → Edit/Write/NotebookEdit, `execute` → Bash, `web` → WebFetch/WebSearch, `todo` → TodoWrite. Les outils sans équivalent sont signalés et ignorés ;
- l'orchestrateur n'est pas converti. Sous Claude Code, c'est la session principale qui joue ce rôle, car un subagent ne peut pas déléguer à son tour.

Les fichiers Copilot restent la source : modifiez-les puis régénérez.

## Configuration du projet (`.crew-view/config.json`, à versionner)

```json
{
  "agentsDirs": ["config/ia/agents"],
  "orchestrator": "orchestrateur",
  "agents": {
    "frontend-builder": { "label": "Front", "color": "#5899da", "accessory": "plant", "desk": [7.8, 3.8] },
    "revue-qualite": { "accessory": "magnifier" },
    "explorateur": { "hidden": true }
  }
}
```

- Les clés de `agents` sont les identifiants (nom normalisé : `Frontend & Builder` → `frontend-builder`) ou les noms tels quels. Les intérimaires ont pour clé `interim-<type>` (par ex. `interim-explore`) ; on peut régler leur `label`, leur `color` et `hidden`.
- Accessoires : `plant`, `lamp`, `mug`, `books`, `server`, `magnifier`, `trophy`, `shield`, `none`.
- `desk` est le coin arrière-gauche du bureau, en tuiles. Par défaut, la salle s'agrandit avec le nombre d'agents. La grille compte 4 colonnes jusqu'à 8 agents, 5 jusqu'à 15 et 6 au-delà (x = 1.4 + 3.2 × colonne ; y = 3.8 + 2.8 × rangée), avec des couloirs entre les colonnes. La table des intérimaires est placée après la dernière rangée. Un poste personnalisé hors de la grille agrandit la salle d'autant.
- Les modifications sont prises en compte à chaud (toutes les 3 s).

## Graphismes personnalisables

Chaque élément de l'open-space est un fichier SVG de `resources/theme/` :
- **mobilier :** bureaux, écran, portable ;
- **décor :** sol, murs, porte, enseigne, cadre, horloge, gyrophare, armoire, fontaine, plante ;
- **accessoires ;**
- **fonds d'écran** selon le statut ;
- **personnage :** pièces animées (tête, buste de face et de dos, bras, avant-bras, jambe, articulation, dossier) et `pivots.json`.

Pour remplacer un élément, enregistre un SVG au même chemin :
1. dans `.crew-view/theme/` du projet (prioritaire, à commiter) ;
2. ou dans le dossier du réglage `crewView.themeDir` (CLI : `--theme-dir`), commun à tous les projets.

Les fichiers absents ou illisibles sont pris au niveau suivant, et la scène se met à jour à l'enregistrement. La commande **Personnaliser les graphismes du projet** (bouton pinceau des Paramètres) copie le thème par défaut dans le projet pour servir de point de départ.

Les conventions (échelle, point d'ancrage, perspective isométrique, `currentColor` = couleur de l'agent) et l'ancrage de chaque fichier sont décrits dans `resources/theme/README.md`.

## Ce qui est représenté

| Statut | Déclencheur dans le transcript | Animation |
|---|---|---|
| Réfléchit | bloc de réflexion, demande reçue, tâche reçue | main au menton, bulle violette (texte de la réflexion quand Claude l'expose, sinon •••) |
| Lit | Read, Grep, Glob, WebFetch, WebSearch | penché vers l'écran |
| Écrit | Edit, Write, NotebookEdit | tape au clavier |
| Exécute | Bash, outils MCP | tape, écran qui pulse, baie serveur qui clignote |
| Délègue | outil Agent / SendMessage | marche jusqu'au bureau cible avec un dossier |
| Rapporte | fin de tâche d'un subagent | va porter son dossier au bureau de l'agent principal |
| Parle | texte de réponse | geste de la main, bulle blanche |
| Attend votre réponse | AskUserQuestion, ExitPlanMode | main levée, bulle rouge |
| Terminé | fin de tour / notification de fin de tâche | s'étire, puis repos après 6 s |

Pendant le travail (réflexion, lecture, écriture, exécution), l'agent est **de dos, face à son écran**, qui affiche son activité : page qui défile, code qui s'écrit, terminal, points de réflexion. Au repos, quand il parle, attend votre réponse ou a fini, il se retourne vers vous.

**Gyrophare.** Fixé au mur du fond, dans l'angle à gauche de l'enseigne, il résume l'état de toute l'équipe :

| Couleur | État | Statuts |
|---|---|---|
| 🔵 bleu | attend ta réponse | Attend votre réponse |
| 🔴 rouge | en travail : écriture | Écrit, Exécute |
| 🟠 orange | en travail : réflexion | Réfléchit, Parle, Délègue |
| 🟡 jaune | en travail : lecture | Lit |
| 🟢 vert | libre pour la suite | Disponible, Terminé |

Il tourne tant qu'il n'est pas vert et reste fixe en vert. Une légende en haut à droite de la vue rappelle les couleurs et met en gras l'état en cours (pastilles seules sur une vue étroite, libellé au survol). Quand plusieurs agents travaillent, la couleur suit l'ordre du tableau : une question passe avant tout, puis l'activité la plus lourde. Un agent qui délègue passe après la lecture, pour laisser voir ce que font ses sous-agents. Une demande de permission (« Autoriser cette commande ? ») n'est pas écrite dans le transcript et n'allume donc pas le bleu.

**Déplacements.** Chaque délégation et chaque rapport sont mémorisés pendant 45 s avec un identifiant. Une vue ouverte, rechargée ou reconnectée rejoue ceux qu'elle n'a pas encore montrés. **Passage de relais :** si l'agent principal délègue pendant qu'un agent vient lui rendre son rapport, c'est cet agent qui emporte le dossier jusqu'au suivant. Un agent relancé alors qu'il avait été lancé dans une session précédente est retrouvé par son type.

**Navigation.** Molette pour zoomer, glisser pour se déplacer, double-clic dans la salle (ou bouton « Recentrer ») pour revenir au cadrage complet.

**Diagnostic.** Dans VS Code, le panneau *Affichage › Sortie › Crew View* trace la session suivie, les agents trouvés, et chaque délégation et rapport. Si un agent ne bouge pas, c'est le premier endroit à regarder.

Une seule session est suivie à la fois : la plus récemment active du projet. Si une nouvelle session démarre, ou si une autre devient active alors que la session suivie est silencieuse depuis 30 s, Crew View bascule sur elle.

## Consommation de tokens

Les compteurs sont lus tels quels dans le champ `usage` de chaque réponse du modèle. Une réponse découpée en plusieurs enregistrements n'est comptée qu'une fois.

| Ligne | Champ du transcript |
|---|---|
| Appels au modèle, Modèle | nombre de réponses distinctes, `model` |
| Entrée | `input_tokens` |
| Cache écrit (dont 5 min / 1 h) | `cache_creation_input_tokens` (`cache_creation.ephemeral_5m/1h_input_tokens`) |
| Cache lu | `cache_read_input_tokens` |
| Tokens lus | entrée + cache écrit + cache lu |
| Tokens produits (dont réflexion) | `output_tokens` (`output_tokens_details.thinking_tokens`) |
| Recherches web, Pages web lues | `server_tool_use.web_search_requests` / `web_fetch_requests` |

Le **coût estimé** est la seule valeur calculée. Il applique la grille publique de l'API Anthropic (`src/pricing.ts`, relevée le 2026-10-20, Fable 5.2 ajouté le 2026-11-23) :
- écriture du cache : 1,25 × le prix d'entrée (5 min) ou 2 × (1 h) ;
- lecture du cache : taux propre à chaque modèle ;
- Haiku 5.5 : deux grilles selon la taille du prompt ;
- mode rapide : 2 × ;
- inférence limitée aux États-Unis : 1,1 × ;
- recherches web : 10 $ les 1 000.

Un modèle sans tarif connu est exclu de l'estimation, et l'écran le signale. Le **coût réel** est celui que Claude Code enregistre lui-même pour la session (enregistrement `cost-state`). Il n'existe qu'au niveau de la session.

### Barre d'état

À droite de « Crew », la barre d'état de VS Code affiche pour le projet courant, par exemple `34 % · ≈ 2,41 $ · 1 h 12` :
- **% de contexte** de la session principale, calculé comme l'indicateur de Claude Code : entrée + cache écrit + cache lu de la dernière réponse, rapportés à la fenêtre du modèle. Les sous-agents ont chacun leur propre contexte et n'entrent pas dans ce chiffre.
- **Coût estimé** de la session, sous-agents compris.
- **Durée de la session**, depuis son premier message (une session reprise avec `--resume` garde sa date de début ; `/clear` démarre une nouvelle session). L'infobulle indique aussi l'heure du dernier échange.

Le fond passe en orange à 80 % de contexte et en rouge à 90 %. L'infobulle détaille les tokens, le modèle, le coût de la demande en cours, le coût enregistré par Claude Code, l'heure de début et le dernier échange. Un clic ouvre la vue « Demandes ».

La fenêtre n'est pas écrite dans le transcript. Par défaut, elle suit la table de Claude Code : 1 M pour les modèles récents (Opus 4.7 et suivants, Sonnet 5 et suivants, Fable, Haiku 5.5), 200 k pour les plus anciens. Si ton compte n'a pas accès au contexte 1 M, règle `crewView.contextWindow` sur `200k` (aussi dans l'onglet Paramètres de la barre latérale).

## Développement

```bash
npm run watch      # build continu
npm run typecheck
npm test           # tests unitaires (node:test)
```

F5 dans VS Code lance une fenêtre de développement avec l'extension (`.vscode/launch.json`).

### Démo sans vraie session

```bash
npm run demo                     # une demande complète (≈ 2 min 30), dans le navigateur
npm run demo -- --loop           # enchaîne les demandes en boucle
npm run demo -- --speed 2        # deux fois plus vite
npm run demo -- --agents 16       # équipe de 16 agents (salle agrandie)
npm run demo -- --port 4800 --no-open
```

La démo crée un projet fictif avec cinq agents au format Copilot (Orchestrateur, Explorateur, Backend, Frontend, Revue Qualité) et joue une session Claude Code en écrivant de vrais transcripts. Tout se trouve sous `demo/`, ignoré par git, avec un dossier Claude isolé : votre `~/.claude` n'est jamais touché.

Déroulé :
1. Vous demandez l'export PDF des candidatures.
2. L'Orchestrateur fait analyser l'existant par l'Explorateur, qui revient avec un plan en deux lots.
3. L'Orchestrateur lance le Backend et le Frontend en parallèle. Le Frontend attend le contrat d'API publié par le Backend.
4. La Revue Qualité trouve une anomalie d'accessibilité. Le Frontend est relancé pour la corriger, puis la Revue valide.
5. L'Orchestrateur vous pose une question.

Chaque agent qui termine sa tâche vient porter son rapport au bureau de l'Orchestrateur ; s'il est encore là quand l'Orchestrateur délègue la suite, c'est lui qui emporte le dossier. Avec `--loop`, une seconde demande (l'export groupé) suit, puis le cycle recommence.

Structure :

```
src/
  extension.ts   commandes VS Code, panneau webview, sélection partagée
  sidebarViews.ts barre latérale (agents, agent sélectionné, paramètres)
  settings.ts    données de l'écran de paramètres, écriture de config.json
  pricing.ts     grille tarifaire publique (coût estimé)
  usage.ts       relevé et cumul de la consommation de tokens
  cli.ts         lancement hors VS Code
  hub.ts         assemble définitions + configuration + session, diffuse l'état
  discovery.ts   recherche et lecture des définitions d'agents
  frontmatter.ts sous-ensemble YAML des frontmatters
  layout.ts      placement des bureaux, apparence par défaut
  session.ts     choix de la session active, suivi des fichiers de subagents
  tail.ts        lecture incrémentale des JSONL
  tracker.ts     enregistrements du transcript → statuts, bulles, délégations
  convert.ts     agents Copilot → subagents Claude Code
  server.ts      serveur local (SSE) pour le navigateur
  webview/       scène isométrique (canvas) et interface
```

## Pistes (v1.1)

- Placement des bureaux par glisser-déposer dans la scène.
- Statistiques de session (durées par agent, coût estimé).
- Plusieurs sessions ou projets simultanés.
