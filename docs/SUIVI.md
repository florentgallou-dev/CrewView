# Suivi — Crew View

## Lots

| Lot | Contenu | État |
|---|---|---|
| 1 | Correctif : fin des tâches déléguées avec `SubagentHandback` — les intérimaires restent « au travail » après avoir rendu leur rapport | Validé, commité, publié (0.8.3) |
| 2 | Agents de la configuration globale (plugins activés, `~/.claude/agents`) : espace « Agents globaux » permanent dans la salle | Validé, commité, tag `v0.9.0` local ; push en attente |
| 3 | Session imposée par l'hôte (`follow`) : Digiworks IDE fait suivre la conversation qu'il affiche ; sans hôte, rien ne change | Validé, commité (sans push) |

## Lot 1 — Fin des tâches déléguées

### Constat (2026-11-25)

Session `6095fc43…` de `~/DEV/digiworks-claude` : `digiworks:testeur` et `digiworks:relecteur` ont fini à 14:25. À 14:31, l'extension VS Code les montre encore avec leurs engrenages. Atelier (devenu digiworks-ide), qui embarque Crew View, les montre au repos, mais seulement parce qu'il a relu la session après coup (`settle` après relecture). Suivie en direct, la session y resterait aussi figée.

La fin d'une tâche déléguée n'est plus écrite comme avant :

- dans le transcript du sous-agent, le dernier `tool_use` est `SubagentHandback` (rapport rendu). Son `tool_result` (« Report delivered… ») remettait l'agent en réflexion ;
- dans la session principale, `<task-notification>` (avec `<tool-use-id>` de l'appel `Agent`) n'apparaît que dans des lignes `queue-operation` (`enqueue`, `remove`) et `attachment` de type `queued_command`, plus dans un message `user` qui commence par `<task-notification>`. Le rapport arrive dans un message `user` d'origine `{ kind: 'peer', handback: true, from, handbackToolUseId }`, non exploité (choix du cadrage : les deux autres signaux suffisent).

Dans `src/tracker.ts` (avant correctif) :

- sur `queue-operation`, la notification ne clôt que les commandes en arrière-plan ; `finishTask` n'est appelé que pour un message `user` ; les `attachment` ne sont pas lus ;
- `SubagentHandback` n'a pas de libellé : la liste affiche « Utilise SubagentHandback ».

Conséquence : les engrenages restent jusqu'à la remise au repos automatique (`STALE_MS`, 15 minutes).

### Étape réalisée (2026-11-25)

- `test/tracker.test.ts` : sept tests, montrés rouges puis verts (sauf la relance par `SendMessage`, déjà correcte dans le code et renforcée à la relecture). Ils couvrent le rapport par `SubagentHandback`, la notification seule en `queue-operation` ou en `attachment`, la relance par `SendMessage` (second rapport), la notification relue après une relance, le rapport lu après la notification un message en file qui cite une notification, et la mémoire bornée des notifications. L'ancien format (notification en message `user`) reste couvert par le test « délégation à un agent du projet ».
- `src/tracker.ts` :
  - `SubagentHandback` clôt la tâche et s'affiche « Rend son rapport ». Lu après la notification, il remet l'agent à « terminé » ;
  - un `tool_result` reçu par une tâche close ne la relance plus ;
  - toute notification (message `user`, `queue-operation`, `attachment` `queued_command`) clôt les tâches de chaque `<tool-use-id>` cité. Elle doit commencer par `<task-notification>` et n'est traitée qu'une fois : la même notification est écrite en `enqueue`, `remove` et `attachment`, et une relance faite entre-temps ne doit pas être refermée. Une nouvelle notification de la même tâche a un autre texte (bloc `<usage>`) ; constaté sur un seul transcript. Seules les 100 dernières notifications sont retenues.
- Rejeu de la session `6095fc43…` : avant, les deux intérimaires restaient « réfléchit » sans rapport ; après, « terminé » et un rapport chacun.
- Version 0.8.3, `crew-view-0.8.3.vsix` construit en local (ni tag ni push).

## Lot 2 — Agents de la configuration globale

### Constat (2026-11-26)

Seuls les agents du projet avaient un bureau. Ceux du plugin `digiworks` (`digiworks:testeur`…) ou de `~/.claude/agents` n'apparaissaient qu'en travail, comme intérimaires anonymes, sans nom propre ni description.

### Étape réalisée (2026-11-26)

Choix du cadrage : rangée permanente ; sources = plugins activés et agents personnels. Décision : [0001-agents-globaux](decisions/0001-agents-globaux.md).

- `src/globalAgents.ts` (nouveau) : découverte des agents personnels et des agents des plugins (`installed_plugins.json`, `enabledPlugins`, clé `agents` du manifeste, repli sur `plugins/cache`).
- `src/layout.ts` : rangées des agents globaux après la grille du projet, `room.globalZone` ; table des intérimaires ensuite.
- `src/hub.ts`, `src/tracker.ts` : découverte relue toutes les 3 s ; `resolve` attribue `digiworks:testeur` ou le nom court `testeur` au bureau global ; `sourceOf` accepte un chemin absolu.
- `src/settings.ts` et la vue (`detail.ts`, `sidebar.ts`, `main.ts`, `room.ts`) : provenance affichée (étiquette « testeur · digiworks », tag, fiche « Agent global · plugin digiworks »), espace au sol « AGENTS GLOBAUX », pas de choix de poste pour un agent global.
- `test/globalAgents.test.ts` : 15 tests (découverte, plugin de projet, désactivation, repli WSL/Windows, manifeste, priorité au projet, placement, hub, suivi, nom court ambigu ou intégré, doublons journalisés, JSON malformés, lien symbolique, chemins WSL/Windows, agent global masqué, poste refusé).
- Relecture (`digiworks:relecteur`) : aucun bloquant ni majeur. Mineurs corrigés : nom court seulement s'il est sans ambiguïté et n'est pas celui d'un agent intégré ; poste refusé côté hôte pour un agent global ; chemins du manifeste confinés au plugin ; liens symboliques suivis (projet compris) ; doublon d'identifiant journalisé ; `projectPath` comparé entre WSL et Windows. Laissés : relecture toutes les 3 s sans cache (négligeable avec un plugin) ; plugin absent de `enabledPlugins` compté comme activé (comportement de Claude Code non vérifié).
- Vérifié sur la vraie configuration : les 4 agents `digiworks:` ont leur bureau dans crew-view ; le rejeu de la dernière session de `~/DEV/digiworks-claude` attribue le travail du testeur et du relecteur à leurs bureaux globaux.
- README (section « Agents globaux »), version 0.9.0.

## Lot 3 — Session imposée par l'hôte

### Constat (2026-11-26)

Le suivi automatique passe à la session la plus récente quand la session suivie est silencieuse depuis 30 s. Une commande longue (10 min) rend la session silencieuse : dans Digiworks IDE, le Crew a basculé sur une autre conversation du projet qui venait de finir et a montré « Disponible » pendant que le travail continuait.

### Étape réalisée (2026-11-26)

- `src/session.ts` : `SessionWatcher.follow(sessionId | undefined)`.
  - Une session imposée est suivie dès que son fichier existe ; sinon le suivi automatique continue.
  - L'identifiant est contrôlé (`[\w-]+`).
  - `undefined` rend la main au suivi automatique : la plus récente est suivie tout de suite, sans attendre 30 s de silence.
- `src/hub.ts` : `CrewHub.follow`, retenu si appelé avant `start`.
- `test/session.test.ts` : trois tests, montrés rouges puis verts : deux avant le code (`follow is not a function`), et un après la relecture (session levée alors que l'imposée venait d'écrire). Suite : 77/77.
- Décision côté hôte : `docs/decisions/0011-crew-suit-la-conversation-ouverte.md` de digiworks-ide. L'extension VS Code n'appelle pas `follow` : comportement inchangé.
- Pas de nouvelle version ni de `.vsix` : digiworks-ide embarque les sources.

## Prochaine action

Pousser depuis un terminal avec identifiants GitHub : `git push origin main v0.9.0` (refusé depuis la session : pas d'identifiants HTTPS, `gh` absent). Puis, côté utilisateur : installer `crew-view-0.9.0.vsix` (ou celui de la release GitHub), puis reconstruire et réinstaller digiworks-ide, qui embarque Crew View (`npm run install:windows` dans `~/DEV/digiworks-ide`). Lot 3 validé et commité ; pousser avec le reste (`git push origin main`).

## Points en attente

- Rendu de l'espace « Agents globaux » à vérifier dans VS Code (non vu pendant le lot 2).
- Plugin absent de `enabledPlugins` compté comme activé : comportement de Claude Code à confirmer.

## Journal

- 2026-11-25 — Suivi créé. Défaut constaté depuis Atelier : intérimaires figés « au travail » après `SubagentHandback`.
- 2026-11-25 — Lot 1 réalisé : clôture sur `SubagentHandback` et sur les notifications en file ; version 0.8.3.
- 2026-11-25 — Lot 1 validé : mémoire des notifications bornée à 100, commit et tag `v0.8.3` locaux ; push refusé (pas d'identifiants GitHub).
- 2026-11-26 — Lot 2 réalisé : agents globaux (plugins, `~/.claude/agents`) dans un espace permanent ; décision 0001 ; version 0.9.0.
- 2026-11-26 — Lot 2 validé : commit et tag `v0.9.0` locaux ; push refusé (pas d'identifiants GitHub). Atelier est renommé `~/DEV/digiworks-ide` ; `~/DEV/atelier` n'existe plus.
- 2026-11-26 — Lot 3 réalisé : session imposée par l'hôte (`follow`), pour Digiworks IDE ; 77/77 après relecture.
- 2026-11-26 — Lot 3 validé avec le lot 12 de digiworks-ide ; commit local.
