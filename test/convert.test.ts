import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { planConversion, writeConversion } from '../src/convert';
import { discoverAgents } from '../src/discovery';
import { parseFrontmatter } from '../src/frontmatter';
import { COPILOT_EXPLORER, COPILOT_FRONT, COPILOT_ORCHESTRATOR, makeProject } from './helpers';

test('conversion Copilot → Claude Code', () => {
  const root = makeProject({
    '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR,
    '.github/agents/explorateur.agent.md': COPILOT_EXPLORER,
    '.github/agents/front.agent.md': COPILOT_FRONT,
  });
  const plan = planConversion(root);
  assert.deepEqual(plan.skippedOrchestrators.map((a) => a.id), ['orchestrateur']);
  assert.deepEqual(plan.agents.map((a) => a.target).sort(), ['.claude/agents/explorateur.md', '.claude/agents/frontend-builder.md']);

  const front = plan.agents.find((a) => a.target.endsWith('frontend-builder.md'))!;
  assert.deepEqual(front.unmappedTools, ['vscode/askQuestions']);
  const { data, body } = parseFrontmatter(front.content);
  assert.equal(data.name, 'frontend-builder');
  assert.equal(data.description, 'Implémentation Nuxt.');
  assert.equal(data.tools, 'Read, Glob, Grep, Edit, Write, NotebookEdit, Bash, TodoWrite');
  assert.match(body, /Tu implémentes le front\./);

  writeConversion(root, plan.agents);
  assert.ok(fs.existsSync(path.join(root, '.claude/agents/explorateur.md')));

  // Les agents générés fusionnent avec leur source : pas de doublon dans la scène.
  assert.deepEqual(discoverAgents(root).map((a) => a.id).sort(), ['explorateur', 'frontend-builder', 'orchestrateur']);

  // Régénération possible : les sources Copilot restent visibles et les cibles sont signalées.
  const again = planConversion(root);
  assert.equal(again.agents.length, 2);
  assert.ok(again.agents.every((a) => a.exists));
});
