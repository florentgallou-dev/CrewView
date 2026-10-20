import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverAgents, normalizeId } from '../src/discovery';
import { parseFrontmatter, toStringList } from '../src/frontmatter';
import { placeAgents } from '../src/layout';
import { COPILOT_EXPLORER, COPILOT_FRONT, COPILOT_ORCHESTRATOR, makeProject } from './helpers';

test('frontmatter : listes inline, chaînes quotées, liste en bloc et scalaire replié', () => {
  const { data, body } = parseFrontmatter(`---
name: "Revue Qualité"
tools: [read, 'search', "edit/editFiles"]
agents:
  - Explorateur
  - "Frontend & Builder"
description: >
  Vérifie l'accessibilité
  et la sécurité.
count: 3
---
Corps`);
  assert.equal(data.name, 'Revue Qualité');
  assert.deepEqual(data.tools, ['read', 'search', 'edit/editFiles']);
  assert.deepEqual(data.agents, ['Explorateur', 'Frontend & Builder']);
  assert.equal(data.description, "Vérifie l'accessibilité et la sécurité.");
  assert.equal(data.count, 3);
  assert.equal(body, 'Corps');
});

test('frontmatter : outils Claude Code sous forme de chaîne', () => {
  assert.deepEqual(toStringList('Read, Grep, Glob'), ['Read', 'Grep', 'Glob']);
  assert.deepEqual(parseFrontmatter('pas de frontmatter').data, {});
});

test('normalizeId rapproche nom lisible, slug et nom de fichier', () => {
  assert.equal(normalizeId('Frontend & Builder'), 'frontend-builder');
  assert.equal(normalizeId('frontend-builder.agent.md'), 'frontend-builder');
  assert.equal(normalizeId('Revue Qualité'), 'revue-qualite');
});

test('découverte : un agent présent en Copilot et en Claude Code n’apparaît qu’une fois', () => {
  const root = makeProject({
    '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR,
    '.github/agents/explorateur.agent.md': COPILOT_EXPLORER,
    '.claude/agents/explorateur.md': '---\nname: explorateur\ndescription: "Analyse"\ntools: Read, Grep\n---\nCorps',
  });
  const agents = discoverAgents(root);
  assert.deepEqual(agents.map((a) => a.id).sort(), ['explorateur', 'orchestrateur']);
  const explorer = agents.find((a) => a.id === 'explorateur')!;
  assert.equal(explorer.name, 'Explorateur', 'le nom lisible de la version Copilot est conservé');
  assert.equal(explorer.source, '.claude/agents/explorateur.md');
  assert.equal(agents.find((a) => a.id === 'orchestrateur')!.isOrchestrator, true);
});

test('découverte : dossier cité dans AGENTS.md via un glob', () => {
  const root = makeProject({
    'AGENTS.md': 'Les agents sont dans `config/ia/agents/*.agent.md`.',
    'config/ia/agents/front.agent.md': COPILOT_FRONT,
  });
  assert.deepEqual(discoverAgents(root).map((a) => a.id), ['frontend-builder']);
});

test('placement : l’orchestrateur prend le grand bureau, la configuration est appliquée', () => {
  const root = makeProject({
    '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR,
    '.github/agents/explorateur.agent.md': COPILOT_EXPLORER,
    '.github/agents/front.agent.md': COPILOT_FRONT,
  });
  const placed = placeAgents(discoverAgents(root), {
    agents: { 'Frontend & Builder': { color: '#123456', desk: [2, 8] }, explorateur: { hidden: true } },
  });
  assert.equal(placed[0].id, 'orchestrateur');
  assert.equal(placed[0].desk.kind, 'boss');
  assert.ok(!placed.some((a) => a.id === 'explorateur'));
  const front = placed.find((a) => a.id === 'frontend-builder')!;
  assert.equal(front.color, '#123456');
  assert.deepEqual([front.desk.x, front.desk.y], [2, 8]);
});

test('placement : sans orchestrateur défini, la session principale reste représentée', () => {
  const placed = placeAgents([], {});
  assert.equal(placed.length, 1);
  assert.equal(placed[0].id, 'main');
  assert.equal(placed[0].isMain, true);
});
