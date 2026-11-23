import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beaconLevel } from '../src/webview/beacon';

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
