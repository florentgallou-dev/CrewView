// Agents de la configuration globale de Claude Code, visibles dans tous les projets :
// agents personnels (~/.claude/agents) et agents des plugins activés.
// Règles de Claude Code (documentation « Subagents » et « Plugins reference ») :
// - ~/.claude/agents est parcouru avec ses sous-dossiers, le nom vient du frontmatter ;
// - un plugin range ses agents dans agents/ (les sous-dossiers entrent dans le nom), sauf si
//   .claude-plugin/plugin.json donne une clé `agents`, qui remplace ce dossier ;
// - un agent de plugin s'appelle « <plugin>:<nom> » ;
// - à nom égal, le projet l'emporte sur l'agent personnel, qui l'emporte sur le plugin.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type AgentDefinition, listAgentFiles, normalizeId, readAgent } from './discovery';

/** Profondeur de sous-dossiers parcourue dans les dossiers d'agents globaux. */
const MAX_DEPTH = 4;

/**
 * Agents globaux, un par identifiant, sans ceux qu'un agent du projet remplace.
 * @param home dossier de configuration de Claude Code (~/.claude ou CLAUDE_CONFIG_DIR)
 * @param root racine du projet (plugins installés ou activés pour ce seul projet)
 * @param projectIds identifiants des agents du projet
 */
export function discoverGlobalAgents(home: string, root: string, projectIds: Iterable<string> = [], log?: (line: string) => void): AgentDefinition[] {
  const project = new Set(projectIds);
  const byId = new Map<string, AgentDefinition>();
  const add = (agent: AgentDefinition) => {
    if (project.has(agent.id)) return; // Remplacé par l'agent du projet, comme dans Claude Code.
    const first = byId.get(agent.id);
    if (first) {
      log?.(`Agent global ignoré : ${agent.source} a le même identifiant (${agent.id}) que ${first.source}`);
      return;
    }
    byId.set(agent.id, agent);
  };
  for (const agent of userAgents(home)) add(agent);
  for (const plugin of enabledPlugins(home, root)) for (const agent of pluginAgents(plugin)) add(agent);
  const agents = [...byId.values()];

  // Nom court d'un agent de plugin : retenu seulement s'il est sans ambiguïté (un seul plugin le porte,
  // aucun agent intégré ni personnel ne s'appelle ainsi). Sinon, seul le nom complet le désigne.
  const counts = new Map<string, number>();
  for (const agent of agents) for (const alias of agent.aliases ?? []) counts.set(alias, (counts.get(alias) ?? 0) + 1);
  for (const agent of agents) {
    if (!agent.aliases) continue;
    agent.aliases = agent.aliases.filter((alias) => counts.get(alias) === 1 && !BUILTIN_AGENTS.has(alias) && !byId.has(alias));
  }
  return agents;
}

/** Agents intégrés à Claude Code (identifiants normalisés) : leur nom ne désigne jamais un agent de plugin. */
const BUILTIN_AGENTS = new Set(['general-purpose', 'explore', 'plan', 'claude', 'statusline-setup', 'output-style-setup']);

function userAgents(home: string): AgentDefinition[] {
  const dir = path.join(home, 'agents');
  return listAgentFiles(dir, 0, MAX_DEPTH).flatMap((file) => {
    const agent = readAgent(dir, file);
    if (!agent) return [];
    return [{ ...agent, source: file, format: 'claude' as const, isOrchestrator: false, delegatesTo: [], global: { scope: 'user' as const } }];
  });
}

// ---- Plugins ------------------------------------------------------------------------------------

export interface InstalledPlugin {
  /** Clé « nom@marketplace ». */
  key: string;
  /** Nom du plugin (manifeste, sinon la clé). */
  name: string;
  dir: string;
}

/** Plugins installés pour l'utilisateur ou pour ce projet, et non désactivés dans les réglages. */
export function enabledPlugins(home: string, root: string): InstalledPlugin[] {
  const enabled = enabledPluginSettings(home, root);
  const plugins: InstalledPlugin[] = [];
  for (const [key, entry] of installedEntries(home, root)) {
    if (enabled[key] === false) continue;
    const dir = pluginDir(home, key, entry);
    if (!dir) continue;
    const manifest = readJson(path.join(dir, '.claude-plugin', 'plugin.json'));
    const name = typeof manifest?.name === 'string' && manifest.name.trim() ? manifest.name.trim() : key.split('@')[0];
    plugins.push({ key, name, dir });
  }
  return plugins;
}

interface InstallEntry {
  scope?: string;
  installPath?: string;
  version?: string;
  projectPath?: string;
}

/** Entrées de plugins/installed_plugins.json qui concernent ce projet (une par plugin). */
function installedEntries(home: string, root: string): [string, InstallEntry][] {
  const data = readJson(path.join(home, 'plugins', 'installed_plugins.json'));
  const plugins = data?.plugins;
  if (!plugins || typeof plugins !== 'object') return [];
  const result: [string, InstallEntry][] = [];
  for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) {
    const entries = (Array.isArray(value) ? value : [value]).filter((e): e is InstallEntry => Boolean(e) && typeof e === 'object');
    const entry = entries.find((e) => !e.projectPath || samePath(e.projectPath, root));
    if (entry) result.push([key, entry]);
  }
  return result;
}

/**
 * Dossier d'un plugin installé. Le chemin enregistré peut ne pas exister de ce côté
 * (fichier écrit sous WSL, lu depuis Windows) : on le retrouve alors dans plugins/cache.
 */
function pluginDir(home: string, key: string, entry: InstallEntry): string | undefined {
  if (entry.installPath && isDir(entry.installPath)) return entry.installPath;
  const [name, marketplace] = key.split('@');
  if (!name || !marketplace) return undefined;
  const base = path.join(home, 'plugins', 'cache', marketplace, name);
  if (entry.version && isDir(path.join(base, entry.version))) return path.join(base, entry.version);
  if (entry.installPath) {
    const byName = path.join(base, path.basename(entry.installPath.replace(/[\\/]+$/, '')));
    if (isDir(byName)) return byName;
  }
  // Dernière version présente dans le cache.
  try {
    const versions = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(base, e.name));
    return versions.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  } catch {
    return undefined;
  }
}

/** Activation des plugins : réglages utilisateur, puis du projet, puis locaux (le dernier l'emporte). */
function enabledPluginSettings(home: string, root: string): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  for (const file of [path.join(home, 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json')]) {
    // Seule la clé enabledPlugins est lue.
    const value = readJson(file)?.enabledPlugins;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [key, on] of Object.entries(value as Record<string, unknown>)) if (typeof on === 'boolean') merged[key] = on;
  }
  return merged;
}

/** Agents d'un plugin, nommés « <plugin>:<sous-dossiers>:<nom> ». */
export function pluginAgents(plugin: InstalledPlugin): AgentDefinition[] {
  const manifest = readJson(path.join(plugin.dir, '.claude-plugin', 'plugin.json'));
  const declared = manifest?.agents;
  const files: { file: string; prefix: string[] }[] = [];
  if (typeof declared === 'string' || Array.isArray(declared)) {
    // Fichiers listés dans le manifeste : sans préfixe de sous-dossier. Un dossier listé est toléré.
    for (const ref of [declared].flat()) {
      if (typeof ref !== 'string') continue;
      const full = path.resolve(plugin.dir, ref);
      // Seuls les fichiers du plugin comptent.
      const relative = path.relative(plugin.dir, full);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if (isDir(full)) files.push(...listAgentFiles(full, 0, 0).map((file) => ({ file, prefix: [] })));
      else if (full.endsWith('.md') && fs.existsSync(full)) files.push({ file: full, prefix: [] });
    }
  } else {
    const dir = path.join(plugin.dir, 'agents');
    for (const file of listAgentFiles(dir, 0, MAX_DEPTH)) {
      files.push({ file, prefix: path.relative(dir, path.dirname(file)).split(path.sep).filter(Boolean) });
    }
  }
  return files.flatMap(({ file, prefix }) => {
    const agent = readAgent(path.dirname(file), file);
    if (!agent) return [];
    const local = [...prefix, agent.name].join(':');
    const id = normalizeId(`${plugin.name}:${local}`);
    return [{
      ...agent,
      id,
      name: local,
      source: file,
      format: 'claude' as const,
      isOrchestrator: false,
      delegatesTo: [],
      global: { scope: 'plugin' as const, plugin: plugin.name },
      // Claude Code accepte aussi le nom court quand aucun autre agent ne le porte.
      aliases: [normalizeId(agent.name)],
    }];
  });
}

// ---- Outils ---------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- fichiers JSON de Claude Code, non typés */
function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function isDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Même dossier, y compris entre WSL et Windows : `/mnt/c/DEV/x` et `C:\\DEV\\x` se valent.
 * La casse n'est ignorée que pour un chemin de lecteur Windows.
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let value = p.replace(/\\/g, '/').replace(/\/+$/, '');
    const mount = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(value);
    if (mount) value = `${mount[1]}:${mount[2] ?? ''}`;
    return /^[a-zA-Z]:/.test(value) ? value.toLowerCase() : value;
  };
  return norm(path.resolve(a)) === norm(path.resolve(b)) || norm(a) === norm(b);
}
