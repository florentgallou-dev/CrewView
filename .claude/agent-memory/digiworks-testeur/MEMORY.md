# Carnet digiworks-testeur (crew-view)

## Pile
- Extension VS Code (crew-view 0.8.3), TypeScript, Node, esbuild, runner `node --test`.
- Aucune base de données. Outils sur l'hôte (pas de conteneur).

## Commandes qui marchent (ordre habituel)
1. `npm run typecheck` (tsc --noEmit) : ~1,6 s
2. `npm test` (node scripts/run-tests.mjs) : 59 tests, ~0,5 s
3. `npm run build` (node esbuild.mjs) : ~0,2 s, se termine par "esbuild : build terminé"

## A ne pas lancer
- `npm run package` (build + vsce package, produit un .vsix)
- `npm run watch` (processus qui ne se termine pas)
- `npm run demo` (build + scripts/demo.mjs)

## Dernière passe (2026-11-25, 3e passe)
- typecheck : OK, aucune erreur.
- test : 59 passés, 0 échec, 0 ignoré, 0 annulé.
- build : OK.

## Tests instables connus
- Aucun.

## Notes
- La sortie de `npm test` est en TAP verbeux : ne lire que la fin (`tail`).
- Pas de docs/decisions consultées.
