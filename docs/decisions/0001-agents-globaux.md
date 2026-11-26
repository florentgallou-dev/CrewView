# 0001 — Agents de la configuration globale de Claude Code

Date : 2026-11-26 · Statut : acceptée

## Contexte

Crew View ne lisait que les agents du projet. Un agent de la configuration globale, comme ceux du plugin `digiworks` (`digiworks:testeur`, `digiworks:relecteur`…) ou un agent personnel de `~/.claude/agents`, n'apparaissait que pendant ses tâches. Il était alors assis à la table des intérimaires, sans nom propre ni description, comme `Explore`. Au repos, rien ne montrait qu'il faisait partie de l'équipe.

## Décision

- Crew View lit les agents globaux dans le dossier de configuration de Claude Code (réglage `claudeConfigDir`) :
  - agents personnels : `agents/`, sous-dossiers compris ;
  - agents des plugins de `plugins/installed_plugins.json` installés pour l'utilisateur ou pour ce projet, sauf ceux désactivés dans `enabledPlugins` ;
  - chez un plugin, `agents/` ou les fichiers listés par la clé `agents` de `.claude-plugin/plugin.json` ;
  - le nom suit Claude Code : `<plugin>:<sous-dossiers>:<nom>`.
- Ces agents ont un bureau permanent dans un espace « Agents globaux », sur des rangées placées après la grille du projet et avant la table des intérimaires. Leur provenance (nom du plugin ou « personnel ») est affichée sur l'étiquette, dans la liste et dans la fiche.
- Les noms se départagent comme dans Claude Code : le projet passe avant l'agent personnel, qui passe avant le plugin. Le nom court d'un agent de plugin le désigne seulement s'il est sans ambiguïté : un seul plugin le porte, aucun agent du projet ou personnel ne s'appelle ainsi, et ce n'est pas le nom d'un agent intégré.
- Les agents intégrés (`Explore`, `Plan`, `general-purpose`) restent des intérimaires.
- Dans les réglages, seule la clé `enabledPlugins` est lue.

Sources : documentation Claude Code « Subagents » et « Plugins reference », consultée le 2026-11-26.

## Conséquences

- La salle grandit d'une rangée par tranche de 4 à 6 agents globaux, selon le nombre de colonnes. On masque un agent avec `hidden` dans `.crew-view/config.json`.
- Les agents globaux se règlent comme ceux du projet (nom, couleur, accessoire, masquage). Leur poste ne se choisit pas.
- Si le chemin d'installation d'un plugin n'existe pas de ce côté (WSL ou Windows), il est cherché dans `plugins/cache`.
- digiworks-ide (`~/DEV/digiworks-ide`), qui embarque Crew View, doit être reconstruit pour en profiter.

## Alternatives écartées

- **Montrer les agents globaux seulement quand ils travaillent**, à une table dédiée : salle plus compacte, mais on ne voit pas l'équipe disponible.
- **Donner aussi un bureau permanent aux agents intégrés** : ils sont présents dans toutes les sessions et ne font pas partie de la configuration de l'équipe.
- **Lire seulement les plugins** : les agents personnels de `~/.claude/agents` resteraient invisibles.
