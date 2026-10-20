// Découverte des agents d'un projet.
// Ordre de priorité : dossiers déclarés dans .crew-view/config.json, puis .claude/agents,
// .github/agents, .agents, et enfin les chemins cités dans AGENTS.md.
// Un même agent présent dans plusieurs formats (ex. généré depuis Copilot) n'apparaît qu'une fois.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatter, toStringList } from './frontmatter';

export type AgentFormat = 'claude' | 'copilot' | 'generic';

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** Chemin relatif à la racine du projet. */
  source: string;
  format: AgentFormat;
  tools: string[];
  delegatesTo: string[];
  isOrchestrator: boolean;
  body: string;
}

export const DEFAULT_AGENT_DIRS = ['.claude/agents', '.github/agents', '.agents'];

/** Identifiant stable : « Frontend & Builder », « frontend-builder » et « frontend-builder.agent.md » donnent le même. */
export function normalizeId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/\.agent$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Agents du projet, un par identifiant. */
export function discoverAgents(root: string, configuredDirs?: string[]): AgentDefinition[] {
  const byId = new Map<string, AgentDefinition>();
  for (const agent of readAgentFiles(root, [...(configuredDirs ?? []), ...DEFAULT_AGENT_DIRS])) {
    const existing = byId.get(agent.id);
    if (!existing) byId.set(agent.id, agent);
    else mergeInto(existing, agent);
  }
  return [...byId.values()];
}

/** Toutes les définitions trouvées dans `dirs` et via AGENTS.md, sans fusion des doublons. */
export function readAgentFiles(root: string, dirs: string[]): AgentDefinition[] {
  const files: string[] = [];
  for (const dir of dirs) files.push(...listAgentFiles(path.resolve(root, dir)));
  files.push(...agentFilesFromAgentsMd(root));
  const seen = new Set<string>();
  const agents: AgentDefinition[] = [];
  for (const file of files) {
    const absolute = path.resolve(file);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    const agent = readAgent(root, absolute);
    if (agent) agents.push(agent);
  }
  return agents;
}

function listAgentFiles(dir: string, depth = 0): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth < 1) files.push(...listAgentFiles(full, depth + 1));
    else if (entry.isFile() && entry.name.endsWith('.md') && !/^readme\.md$/i.test(entry.name)) files.push(full);
  }
  return files;
}

/** Chemins d'agents mentionnés dans AGENTS.md : liens markdown ou chemins entre backticks, globs compris. */
function agentFilesFromAgentsMd(root: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  } catch {
    return [];
  }
  const candidates = new Set<string>();
  for (const match of text.matchAll(/\]\(([^)\s]+)\)|`([^`\s]+)`/g)) {
    const ref = (match[1] ?? match[2]).replace(/^\.\//, '');
    if (!/agent/i.test(ref)) continue;
    if (ref.includes('*')) {
      const dir = ref.slice(0, ref.indexOf('*'));
      for (const file of listAgentFiles(path.resolve(root, path.dirname(dir + 'x')))) candidates.add(file);
    } else if (ref.endsWith('.md') && !/^agents\.md$/i.test(path.basename(ref))) {
      const full = path.resolve(root, ref);
      if (fs.existsSync(full)) candidates.add(full);
    }
  }
  return [...candidates];
}

function readAgent(root: string, file: string): AgentDefinition | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const { data, body } = parseFrontmatter(text);
  const relative = path.relative(root, file).split(path.sep).join('/');
  const format: AgentFormat = file.endsWith('.agent.md') || relative.startsWith('.github/')
    ? 'copilot'
    : relative.startsWith('.claude/')
      ? 'claude'
      : 'generic';

  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : path.basename(file).replace(/(\.agent)?\.md$/, '');
  const tools = toStringList(data.tools);
  const delegatesTo = toStringList(data.agents).map(normalizeId);
  const id = normalizeId(name);
  if (!id) return undefined;

  return {
    id,
    name,
    description: typeof data.description === 'string' ? data.description : '',
    source: relative,
    format,
    tools,
    delegatesTo,
    isOrchestrator: delegatesTo.length > 0 || tools.some((t) => t.toLowerCase() === 'agent'),
    body,
  };
}

/** Fusionne une seconde définition du même agent : le nom lisible et l'orchestration priment. */
function mergeInto(target: AgentDefinition, other: AgentDefinition): void {
  if (!target.description && other.description) target.description = other.description;
  if (/^[a-z0-9-]+$/.test(target.name) && !/^[a-z0-9-]+$/.test(other.name)) target.name = other.name;
  if (other.isOrchestrator) target.isOrchestrator = true;
  if (!target.delegatesTo.length) target.delegatesTo = other.delegatesTo;
}
