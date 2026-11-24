import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLevel, beaconLevel, gearAngles } from '../src/webview/beacon';

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

test('engrenages : sens opposés, rapport des dents, et toujours une dent du grand face à un creux du petit', () => {
  const big = { dents: 14, centre: [13, -2] as [number, number] };
  const small = { dents: 9, centre: [21.95, 4.27] as [number, number] };
  const line = Math.atan2(small.centre[1] - big.centre[1], small.centre[0] - big.centre[0]);
  const mod = (a: number, p: number) => ((a % p) + p) % p;
  const a0 = gearAngles(0, big, small);
  const a1 = gearAngles(0.5, big, small);
  assert.ok(Math.abs((a1.petit - a0.petit) / (a1.grand - a0.grand) + 14 / 9) < 1e-9, 'le petit tourne 14/9 fois plus vite, en sens inverse');
  for (let t = 0; t < 5; t += 0.137) {
    const { grand, petit } = gearAngles(t, big, small);
    // Position, dans chaque roue, du point de contact sur la ligne des centres.
    const u = mod(line - grand, (2 * Math.PI) / 14) / ((2 * Math.PI) / 14);
    const v = mod(line + Math.PI - petit, (2 * Math.PI) / 9) / ((2 * Math.PI) / 9);
    // Quand le grand présente une dent (u = 0), le petit présente un creux (v = ½) ; les deux avancent ensemble.
    assert.ok(Math.abs(mod(u + v - 0.5, 1)) < 1e-9 || Math.abs(mod(u + v - 0.5, 1) - 1) < 1e-9, `t = ${t}`);
  }
});
