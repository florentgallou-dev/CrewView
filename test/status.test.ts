import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engineLabel } from '../src/webview/status';

test('capsule modèle et effort : famille, version, effort', () => {
  assert.equal(engineLabel('claude-sonnet-5-5', 'medium'), 'sonnet-5.5 · medium');
  assert.equal(engineLabel('claude-opus-5-5', 'high'), 'opus-5.5 · high');
  assert.equal(engineLabel('claude-opus-4-1-20250805', 'low'), 'opus-4.1 · low', 'date retirée');
  assert.equal(engineLabel('claude-opus-5-5[1m]', 'xhigh'), 'opus-5.5 · xhigh', 'suffixe de contexte retiré');
  assert.equal(engineLabel('claude-3-5-sonnet-20241022', undefined), 'sonnet-3.5', 'ancien format, sans effort');
  assert.equal(engineLabel('claude-haiku-4', undefined), 'haiku-4');
  assert.equal(engineLabel('gpt-test', 'high'), 'gpt-test · high', 'modèle inconnu : tel quel');
  assert.equal(engineLabel(undefined, 'high'), undefined, 'sans modèle, pas de capsule');
});
