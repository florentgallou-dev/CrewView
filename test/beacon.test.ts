import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLevel, beaconLevel } from '../src/webview/beacon';

test('le gyrophare est vert quand toute l’équipe est libre', () => {
  assert.equal(beaconLevel([]), 'free');
  assert.equal(beaconLevel(['idle', 'done']), 'free');
});

test('le gyrophare prend la couleur de l’activité la plus prioritaire', () => {
  assert.equal(beaconLevel(['idle', 'reading']), 'reading');
  assert.equal(beaconLevel(['reading', 'talking']), 'thinking');
  assert.equal(beaconLevel(['thinking', 'delegating', 'running']), 'writing');
  assert.equal(beaconLevel(['writing', 'asking', 'reading']), 'question');
});

test('un agent qui délègue laisse voir l’activité de ses sous-agents', () => {
  assert.equal(beaconLevel(['delegating']), 'thinking');
  assert.equal(beaconLevel(['delegating', 'reading']), 'reading');
  assert.equal(beaconLevel(['delegating', 'idle', 'writing']), 'writing');
});

test('une commande en arrière-plan passe le gyrophare en violet seulement si l’équipe semble libre', () => {
  assert.equal(beaconLevel(['idle', 'done'], true), 'background');
  assert.equal(beaconLevel(['idle', 'reading'], true), 'reading');
  assert.equal(beaconLevel(['idle'], false), 'free');
});

test('engrenage : couleur de l’état de l’agent, aucun quand il est libre', () => {
  const task = { toolUseId: 't', label: 'x', since: 0 };
  assert.equal(agentLevel({ status: 'idle', background: [] }), undefined);
  assert.equal(agentLevel({ status: 'done', background: [] }), undefined);
  assert.equal(agentLevel({ status: 'writing', background: [] }), 'writing');
  assert.equal(agentLevel({ status: 'idle', background: [task] }), 'background');
  assert.equal(agentLevel({ status: 'asking', background: [task] }), 'question');
});
