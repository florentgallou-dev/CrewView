# 0002 — Modèle et effort lus dans le transcript

Date : 2026-11-27 · Statut : acceptée

## Contexte

On veut afficher sous les engrenages d'un agent en travail le modèle et l'effort de raisonnement qu'il utilise. Claude Code ne publie pas ces valeurs ailleurs que dans ses transcripts. Sur ceux du 2026-11-27, chaque ligne `assistant` (session principale et sous-agents) porte :

- `message.model`, par exemple `claude-sonnet-5-5` (`<synthetic>` pour un message produit par Claude Code lui-même : erreur d'API, interruption) ;
- un champ `effort` au premier niveau, par exemple `"medium"`.

Ce format n'est pas documenté et peut changer sans préavis. Le fichier `<agent>.meta.json` d'un sous-agent ne donne pas l'effort.

## Décision

- Crew View retient, pour chaque agent, le modèle et l'effort de sa dernière réponse (`AgentRuntime.model`, `AgentRuntime.effort`).
- Un message `<synthetic>` ne change rien. Une réponse sans `effort` efface l'effort précédent : on n'affiche pas un effort qui ne correspond plus au modèle.
- La scène montre une capsule « modèle · effort » sous les engrenages, seulement quand ils tournent. Le libellé retire le préfixe `claude-`, la date et le suffixe de contexte (`[1m]`) : `sonnet-5.5 · medium`. Un identifiant inconnu reste tel quel ; sans modèle, pas de capsule.

## Conséquences

- Si Claude Code cesse d'écrire ces champs, la capsule disparaît (ou n'affiche que le modèle) sans autre effet : rien d'autre n'en dépend.
- Un sous-agent relancé avec un autre modèle montre l'ancien jusqu'à sa première réponse.
- digiworks-ide, qui embarque la scène, montre la capsule après reconstruction.

## Alternatives écartées

- Lire le modèle dans le frontmatter de l'agent (`model:`) : ne dit rien de l'effort, ni du modèle réellement utilisé quand le champ vaut `inherit` ou est absent.
- Afficher la capsule en permanence, au repos compris : rejeté au cadrage, pour ne pas charger la salle.
