import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { CONFIG_FILE } from '../src/config';
import { CrewHub } from '../src/hub';
import { applyTempLook, DESK_SLOTS, placeTemp } from '../src/layout';
import { applyAgentPatch, applyProjectPatch, buildSettings } from '../src/settings';
import { COPILOT_EXPLORER, COPILOT_FRONT, COPILOT_ORCHESTRATOR, makeProject } from './helpers';

function setup(config?: unknown) {
  const files: Record<string, string> = {
    '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR,
    '.github/agents/explorateur.agent.md': COPILOT_EXPLORER,
    '.github/agents/front.agent.md': COPILOT_FRONT,
  };
  if (config !== undefined) files[CONFIG_FILE] = typeof config === 'string' ? config : JSON.stringify(config);
  const root = makeProject(files);
  const hub = new CrewHub({ root, claudeConfigDir: path.join(root, 'no-claude') });
  hub.reload();
  const read = () => JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'));
  return { root, hub, read };
}

const general = { port: 4719, claudeConfigDir: '' };

test('paramètres : agent principal en tête, postes par défaut reconnus', () => {
  const { hub } = setup();
  const data = buildSettings(hub, general);
  assert.equal(data.configExists, false);
  assert.deepEqual(data.agents.map((a) => a.id), ['orchestrateur', 'explorateur', 'frontend-builder']);
  assert.equal(data.agents[0].isMain, true);
  assert.equal(data.agents[1].slot, 0);
  assert.equal(data.agents[2].slot, 1);
});

test('choisir un poste occupé échange les deux agents', () => {
  const { hub, read } = setup();
  applyAgentPatch(hub, 'explorateur', { slot: 1 });
  const agents = read().agents;
  assert.deepEqual(agents.explorateur.desk, [DESK_SLOTS[1].x, DESK_SLOTS[1].y]);
  assert.deepEqual(agents['frontend-builder'].desk, [DESK_SLOTS[0].x, DESK_SLOTS[0].y]);
  const data = buildSettings(hub, general);
  assert.equal(data.agents.find((a) => a.id === 'explorateur')!.slot, 1);
  assert.equal(data.agents.find((a) => a.id === 'frontend-builder')!.slot, 0);
});

test('nom vidé et démasquage retirent les clés ; entrée vide supprimée', () => {
  const { hub, read } = setup({ agents: { Explorateur: { label: 'Explo', hidden: true }, keep: { color: '#000000' } }, custom: 42 });
  assert.ok(!hub.snapshot().agents.some((a) => a.id === 'explorateur'), 'agent masqué absent de la scène');
  assert.equal(buildSettings(hub, general).agents.find((a) => a.id === 'explorateur')!.hidden, true);

  applyAgentPatch(hub, 'explorateur', { label: '  ', hidden: false });
  const config = read();
  assert.equal(config.agents.Explorateur, undefined, 'la clé existante « Explorateur » est réutilisée puis supprimée');
  assert.equal(config.custom, 42, 'les clés inconnues sont conservées');
  assert.ok(hub.snapshot().agents.some((a) => a.id === 'explorateur'));
});

test('projet : orchestrateur et dossiers d’agents', () => {
  const { hub, read } = setup();
  applyProjectPatch(hub, { orchestrator: 'explorateur', agentsDirs: [' config/ia ', ''] });
  assert.deepEqual(read(), { orchestrator: 'explorateur', agentsDirs: ['config/ia'] });
  assert.equal(hub.snapshot().agents[0].id, 'explorateur');
  applyProjectPatch(hub, { orchestrator: '', agentsDirs: [] });
  assert.deepEqual(read(), {});
});

test('une configuration JSON invalide n’est jamais écrasée', () => {
  const { hub, root } = setup('{ invalide');
  assert.throws(() => applyAgentPatch(hub, 'explorateur', { color: '#112233' }), /invalide/);
  assert.equal(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'), '{ invalide');
  assert.match(hub.configError ?? '', /invalide/);
});

test('apparence des intérimaires : nom, couleur, masquage', () => {
  const temp = placeTemp('interim-explore', 'Explore', 0);
  assert.equal(applyTempLook(temp, { agents: { 'interim-explore': { label: 'Éclaireur', color: '#123456' } } })?.name, 'Éclaireur');
  assert.equal(applyTempLook(temp, { agents: { 'interim-explore': { hidden: true } } }), undefined);
  assert.equal(applyTempLook(temp, {})?.color, temp.color);
});
