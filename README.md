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
| Initialiser la configuration du projet | Crée `.crew-view/config.json` |

### Sans VS Code (CLI)

```bash
npm install && npm run build
node dist/cli.js /chemin/du/projet            # ouvre le navigateur
node dist/cli.js . --port 4800 --no-open
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

- Les clés de `agents` sont les identifiants (nom normalisé : `Frontend & Builder` → `frontend-builder`) ou les noms tels quels.
- Accessoires : `plant`, `lamp`, `mug`, `books`, `server`, `magnifier`, `trophy`, `shield`, `none`.
- `desk` est le coin arrière-gauche du bureau, en tuiles, dans une salle de 14 × 11. Les emplacements par défaut sont deux rangées de quatre bureaux (y = 3.8 et 6.6 ; x = 1.4, 4.6, 7.8, 11), puis deux postes à l'avant gauche. L'avant droit est réservé à l'intérim.
- Les modifications sont prises en compte à chaud (toutes les 3 s).

## Ce qui est représenté

| Statut | Déclencheur dans le transcript | Animation |
|---|---|---|
| Réfléchit | bloc de réflexion, demande reçue, tâche reçue | main au menton, bulle violette (texte de la réflexion quand Claude l'expose, sinon •••) |
| Lit | Read, Grep, Glob, WebFetch, WebSearch | penché vers l'écran |
| Écrit | Edit, Write, NotebookEdit | tape au clavier |
| Exécute | Bash, outils MCP | tape, écran qui pulse, baie serveur qui clignote |
| Délègue | outil Agent / SendMessage | marche jusqu'au bureau cible avec un dossier |
| Parle | texte de réponse | geste de la main, bulle blanche |
| Attend votre réponse | AskUserQuestion, ExitPlanMode | main levée, bulle rouge |
| Terminé | fin de tour / notification de fin de tâche | s'étire, puis repos après 6 s |

Une seule session est suivie à la fois : la plus récemment active du projet. Si une nouvelle session démarre, ou si une autre devient active alors que la session suivie est silencieuse depuis 30 s, Crew View bascule sur elle.

## Développement

```bash
npm run watch      # build continu
npm run typecheck
npm test           # tests unitaires (node:test)
```

F5 dans VS Code lance une fenêtre de développement avec l'extension (`.vscode/launch.json`).

Démo sans vraie session (utilisez un dossier Claude de démo, jamais votre `~/.claude`) :

```bash
node scripts/simulate.mjs /chemin/projet-demo /tmp/claude-demo &
node dist/cli.js /chemin/projet-demo --claude-dir /tmp/claude-demo
```

Structure :

```
src/
  extension.ts   commandes VS Code, panneau webview
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

- Écran de paramètres visuel (placement des bureaux par glisser-déposer, couleurs, accessoires).
- Statistiques de session (durées par agent, coût estimé).
- Plusieurs sessions ou projets simultanés.
