// Génère des subagents Claude Code (.claude/agents/*.md) à partir des agents Copilot (.agent.md).
// L'orchestrateur n'est pas converti : sous Claude Code, c'est la session principale qui joue ce rôle
// (un subagent ne peut pas lui-même déléguer à d'autres subagents).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_AGENT_DIRS, readAgentFiles, type AgentDefinition } from './discovery';

export const CLAUDE_AGENTS_DIR = '.claude/agents';

/** Outils Copilot → outils Claude Code. Les noms « jeu/outil » sont lus via leur préfixe. */
const TOOL_MAP: Record<string, string[]> = {
  read: ['Read', 'Glob', 'Grep'],
  search: ['Grep', 'Glob'],
  codebase: ['Grep', 'Glob'],
  edit: ['Edit', 'Write', 'NotebookEdit'],
  editfiles: ['Edit', 'Write'],
  execute: ['Bash'],
  runcommands: ['Bash'],
  terminal: ['Bash'],
  runinterminal: ['Bash'],
  web: ['WebFetch', 'WebSearch'],
  fetch: ['WebFetch'],
  websearch: ['WebSearch'],
  todo: ['TodoWrite'],
  todos: ['TodoWrite'],
};

export interface PlannedAgent {
  source: string;
  target: string;
  name: string;
  content: string;
  exists: boolean;
  unmappedTools: string[];
}

export interface ConversionPlan {
  agents: PlannedAgent[];
  skippedOrchestrators: AgentDefinition[];
}

export function planConversion(root: string): ConversionPlan {
  const copilot = readAgentFiles(root, DEFAULT_AGENT_DIRS).filter((a) => a.format === 'copilot');
  const plan: ConversionPlan = { agents: [], skippedOrchestrators: [] };
  for (const agent of copilot) {
    if (agent.isOrchestrator) {
      plan.skippedOrchestrators.push(agent);
      continue;
    }
    const { tools, unmapped } = mapTools(agent.tools);
    const target = `${CLAUDE_AGENTS_DIR}/${agent.id}.md`;
    plan.agents.push({
      source: agent.source,
      target,
      name: agent.name,
      content: renderClaudeAgent(agent, tools),
      exists: fs.existsSync(path.join(root, target)),
      unmappedTools: unmapped,
    });
  }
  return plan;
}

export function writeConversion(root: string, agents: PlannedAgent[]): string[] {
  const written: string[] = [];
  for (const agent of agents) {
    const file = path.join(root, agent.target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, agent.content, 'utf8');
    written.push(agent.target);
  }
  return written;
}

function mapTools(copilotTools: string[]): { tools: string[]; unmapped: string[] } {
  const tools = new Set<string>();
  const unmapped: string[] = [];
  for (const tool of copilotTools) {
    const key = tool.split('/')[0].toLowerCase().replace(/[^a-z]/g, '');
    if (key === 'agent') continue; // pas de délégation depuis un subagent
    const mapped = TOOL_MAP[key];
    if (mapped) mapped.forEach((t) => tools.add(t));
    else unmapped.push(tool);
  }
  return { tools: [...tools], unmapped };
}

function renderClaudeAgent(agent: AgentDefinition, tools: string[]): string {
  const lines = ['---', `name: ${agent.id}`, `description: ${JSON.stringify(agent.description || agent.name)}`];
  // Sans liste d'outils dans la source, l'agent hérite de tous les outils de la session.
  if (agent.tools.length) lines.push(`tools: ${tools.join(', ')}`);
  lines.push('---', `<!-- Généré par Crew View depuis ${agent.source} : modifiez la source puis régénérez. -->`, '');
  return `${lines.join('\n')}\n${agent.body.trimStart()}`;
}
