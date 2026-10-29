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

test('découverte : un document sans frontmatter d’agent n’est pas un agent', () => {
  const root = makeProject({
    'AGENTS.md': 'Voir [l’organisation agentique](docs/13-organisation-agentique.md).',
    'docs/13-organisation-agentique.md': '# Organisation agentique\n\nTexte.',
    '.claude/agents/devops.md': '---\nname: devops\ndescription: "Docker et CI"\n---\nCorps',
    '.claude/agents/notes.md': '---\ntitle: brouillon\n---\nPas un agent',
  });
  assert.deepEqual(discoverAgents(root).map((a) => a.id), ['devops']);
});

test('placement : l’orchestrateur prend le grand bureau, la configuration est appliquée', () => {
  const root = makeProject({
    '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR,
    '.github/agents/explorateur.agent.md': COPILOT_EXPLORER,
    '.github/agents/front.agent.md': COPILOT_FRONT,
  });
  const { agents: placed } = placeAgents(discoverAgents(root), {
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
  const { agents: placed } = placeAgents([], {});
  assert.equal(placed.length, 1);
  assert.equal(placed[0].id, 'main');
  assert.equal(placed[0].isMain, true);
});

test('placement : 16 agents, chacun son bureau, salle agrandie et couloirs entre les colonnes', () => {
  const files: Record<string, string> = { '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR };
  for (let i = 1; i <= 15; i++) files[`.claude/agents/agent-${i}.md`] = `---\nname: agent-${i}\ndescription: "Agent ${i}"\n---\nCorps`;
  const { agents, room, slots } = placeAgents(discoverAgents(makeProject(files)), {});
  assert.equal(agents.length, 16);
  const desks = agents.map((a) => `${a.desk.x},${a.desk.y}`);
  assert.equal(new Set(desks).size, 16, 'aucun bureau partagé');
  assert.equal(slots.length, 15, '5 colonnes × 3 rangées');
  assert.ok(room.width > 14 && room.depth > 12.1, 'la salle grandit');
  assert.equal(room.aisles.length, 6, 'un couloir de chaque côté et entre chaque colonne');
  for (const agent of agents) {
    assert.ok(agent.desk.x + agent.desk.w < room.width && agent.desk.y + agent.desk.d < room.depth, `${agent.id} dans la salle`);
    assert.ok(agent.spot[1] > agent.desk.y + agent.desk.d, `${agent.id} devant son bureau`);
  }
});
