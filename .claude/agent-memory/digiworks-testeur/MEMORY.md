# Carnet digiworks-testeur (crew-view)

## Pile
- Extension VS Code (crew-view 0.9.0), TypeScript, Node, esbuild, runner `node --test`.
- Aucune base de données. Outils sur l'hôte (pas de conteneur).

## Commandes qui marchent (ordre habituel)
1. `npm run typecheck` (tsc --noEmit) : ~2 s
2. `npm test` (node scripts/run-tests.mjs) : 74 tests, ~0,3 s
3. `npm run build` (node esbuild.mjs) : ~0,3 s, se termine par "esbuild : build terminé"

## A ne pas lancer
- `npm run package` (build + vsce package, produit un .vsix)
- `npm run watch` (processus qui ne se termine pas)
- `npm run demo` (build + scripts/demo.mjs)

## Projet voisin : /home/user/DEV/digiworks-ide (Electron, embarque crew-view)
- Scripts : `npm run typecheck` (~2,4 s, OK), `npm test` (scripts/run-tests.mjs), `npm run build` (scripts/build.mjs, ~0,7 s, OK).
- A ne pas lancer : `install:windows`, `dev`.
- Résumé des tests : `npm test 2>&1 | grep -E '^# (tests|pass|fail|cancelled|skipped)|^not ok'`.

## Dernière passe crew-view (2026-11-26, v0.9.0)
- typecheck OK, test 74 passés / 0 échec, build OK.

## Tests instables connus
- Aucun.

## Notes
- La sortie de `npm test` est en TAP verbeux : filtrer avec grep.
- Pas de docs/decisions consultées.
