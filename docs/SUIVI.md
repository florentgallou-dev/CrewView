# Suivi — Crew View

## Lots

| Lot | Contenu | État |
|---|---|---|
| 1 | Correctif : fin des tâches déléguées avec `SubagentHandback` — les intérimaires restent « au travail » après avoir rendu leur rapport | Validé, commité ; publication 0.8.3 en attente |

## Lot 1 — Fin des tâches déléguées

### Constat (2026-11-25)

Session `6095fc43…` de `~/DEV/digiworks-claude` : `digiworks:testeur` et `digiworks:relecteur` ont fini à 14:25. À 14:31, l'extension VS Code les montre encore avec leurs engrenages. Atelier, qui embarque Crew View, les montre au repos, mais seulement parce qu'il a relu la session après coup (`settle` après relecture). Suivie en direct, la session y resterait aussi figée.

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

## Prochaine action

Publier la 0.8.3 : `git push origin main v0.8.3`, refusé depuis la session (pas d'identifiants GitHub en HTTPS). Puis, côté utilisateur : installer `crew-view-0.8.3.vsix` (ou celui de la release GitHub), reconstruire et réinstaller Atelier (`npm run build`, puis `npm run install:windows` dans `~/DEV/atelier`). Aucun lot suivant n'est ouvert.

## Points en attente

- `docs/decisions/` n'existe pas encore : le créer à la première décision.

## Journal

- 2026-11-25 — Suivi créé. Défaut constaté depuis Atelier : intérimaires figés « au travail » après `SubagentHandback`.
- 2026-11-25 — Lot 1 réalisé : clôture sur `SubagentHandback` et sur les notifications en file ; version 0.8.3.
- 2026-11-25 — Lot 1 validé : mémoire des notifications bornée à 100, commit et tag `v0.8.3` locaux ; push refusé (pas d'identifiants GitHub).
