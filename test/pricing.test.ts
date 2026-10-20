import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseModelId, estimateCostUsd } from '../src/pricing';
import { emptyUsage } from '../src/usage';

const usage = (values: Partial<ReturnType<typeof emptyUsage>>) => ({ ...emptyUsage(), ...values });
const close = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);

test('identifiants de modèle : suffixes de contexte et de date retirés', () => {
  assert.equal(baseModelId('claude-sonnet-5-5[1m]'), 'claude-sonnet-5-5');
  assert.equal(baseModelId('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
});

test('tarifs : lecture du cache propre à chaque modèle, écriture 1,25 × / 2 ×', () => {
  const million = usage({ cacheRead: 1_000_000 });
  close(estimateCostUsd('claude-fable-5-1', million), 0.25);
  close(estimateCostUsd('claude-opus-5-5', million), 0.2);
  close(estimateCostUsd('claude-sonnet-5-5', million), 0.1);
  close(estimateCostUsd('claude-sonnet-5', million), 0.2);
  close(estimateCostUsd('claude-opus-4-8', million), 0.5);
  close(estimateCostUsd('claude-sonnet-5-5', usage({ cacheWrite: 1_000_000, cacheWrite1h: 1_000_000 })), 4);
  // Sans détail par durée : tarif 5 minutes.
  close(estimateCostUsd('claude-sonnet-5-5', usage({ cacheWrite: 1_000_000 })), 2.5);
  close(estimateCostUsd('claude-opus-5-5', usage({ output: 1_000_000, webSearches: 3 })), 20.03);
});

test('Haiku 5.5 : deux grilles selon la taille du prompt ; mode rapide ; modèle inconnu', () => {
  close(estimateCostUsd('claude-haiku-5-5', usage({ input: 100_000, output: 1_000 })), (100_000 * 0.1 + 1_000 * 0.5) / 1e6);
  close(estimateCostUsd('claude-haiku-5-5', usage({ input: 100_001, output: 1_000 })), (100_001 * 0.5 + 1_000 * 2.5) / 1e6);
  close(estimateCostUsd('claude-opus-5-5', usage({ output: 1_000_000 }), { fast: true }), 40);
  close(estimateCostUsd('claude-opus-4-8', usage({ output: 1_000_000 }), { fast: true }), 50);
  assert.equal(estimateCostUsd('claude-sonnet-5-5', usage({ output: 1 }), { fast: true }), undefined, 'pas de mode rapide sur Sonnet');
  close(estimateCostUsd('claude-sonnet-5-5', usage({ output: 1_000_000 }), { inferenceGeo: 'us' }), 11);
  close(estimateCostUsd('claude-haiku-4-5', usage({ output: 1_000_000 }), { inferenceGeo: 'us' }), 5);
  close(estimateCostUsd('claude-sonnet-5-5', usage({ output: 1_000_000 }), { inferenceGeo: 'not_available' }), 10);
  assert.equal(estimateCostUsd('<synthetic>', usage({ output: 1 })), undefined);
});
