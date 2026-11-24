import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextWindowOf, duration, statusSummary } from '../src/context';
import type { RequestSummary, SceneState } from '../src/types';
import { emptyUsage, usageOfMessage } from '../src/usage';

test('fenêtre de contexte : 1 M pour les modèles récents, 200 k pour les anciens, réglage prioritaire', () => {
  assert.equal(contextWindowOf('claude-opus-5-5'), 1_000_000);
  assert.equal(contextWindowOf('claude-fable-5-2'), 1_000_000);
  assert.equal(contextWindowOf('claude-haiku-5-5'), 1_000_000);
  assert.equal(contextWindowOf('claude-opus-4-7'), 1_000_000);
  assert.equal(contextWindowOf('claude-opus-4-6'), 200_000);
  assert.equal(contextWindowOf('claude-sonnet-4-5-20250929'), 200_000);
  assert.equal(contextWindowOf('claude-haiku-4-5-20251001'), 200_000);
  assert.equal(contextWindowOf('claude-sonnet-4-6[1m]'), 1_000_000);
  assert.equal(contextWindowOf('claude-opus-5-5', '200k'), 200_000);
  assert.equal(contextWindowOf('claude-haiku-4-5', '1m'), 1_000_000);
});

function state(partial: Partial<SceneState>): SceneState {
  return { project: 'p', watching: true, agents: [], requests: [], moves: [], room: { width: 10, depth: 8, aisles: [] }, ...partial };
}
const request = (costUsd: number): RequestSummary => ({ id: String(costUsd), at: 0, prompt: 'x', total: { ...emptyUsage(), costUsd }, byAgent: {} });

test('barre d’état : % de contexte, coût estimé et alerte près de la limite', () => {
  assert.equal(statusSummary(state({ watching: false })), undefined);
  assert.equal(statusSummary(state({})), undefined, 'session sans réponse : rien à afficher');

  const summary = statusSummary(state({ context: { tokens: 342_000, model: 'claude-opus-5-5' }, requests: [request(1.5), request(0.91)] }));
  assert.equal(summary?.text, '$(pie-chart) 34 % · ≈ 2,41 $');
  assert.equal(summary?.level, 'normal');
  assert.ok(summary?.details.some((line) => line.includes('342 k / 1 M')));
  assert.ok(summary?.details.some((line) => line.includes('Demande en cours : ≈ 0,91 $')));

  assert.equal(statusSummary(state({ context: { tokens: 170_000, model: 'claude-opus-5-5' } }), '200k')?.level, 'warning');
  assert.equal(statusSummary(state({ context: { tokens: 190_000, model: 'claude-haiku-4-5' } }))?.level, 'error');
});

test('les messages synthétiques de Claude Code ne comptent pas comme des appels au modèle', () => {
  assert.equal(usageOfMessage({ model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } }), undefined);
  assert.equal(usageOfMessage({ model: 'claude-opus-5-5', usage: { input_tokens: 3, output_tokens: 1 } })?.calls, 1);
});

test('barre d’état : durée de la session et dernier échange', () => {
  assert.equal(duration(30_000), '0 min');
  assert.equal(duration(12 * 60_000), '12 min');
  assert.equal(duration(65 * 60_000), '1 h 05');
  assert.equal(duration((51 * 60 + 7) * 60_000), '2 j 3 h');

  const now = new Date(2026, 10, 23, 15, 17).getTime();
  const startedAt = new Date(2026, 10, 23, 14, 5).getTime();
  const summary = statusSummary(state({ startedAt, lastActivityAt: now - 3 * 60_000 }), 'auto', now);
  assert.equal(summary?.text, '$(clock) 1 h 12');
  assert.ok(summary?.details.includes('**Session ouverte depuis** 14 h 05 (1 h 12)'));
  assert.ok(summary?.details.includes('Dernier échange : il y a 3 min'));
});

test('barre d’état : commandes en arrière-plan dans l’infobulle', () => {
  const now = new Date(2026, 10, 24, 9, 0).getTime();
  const runtime = { status: 'idle' as const, statusAt: 0, files: [], history: [], usage: emptyUsage(), activeTasks: 0, background: [{ toolUseId: 't', label: 'Mutation du lot 1', since: new Date(2026, 10, 24, 8, 21).getTime() }] };
  const agent = { id: 'claude', name: 'Claude', description: '', color: '#000', accessory: 'none' as const, desk: { x: 0, y: 0, w: 1, d: 1, kind: 'boss' as const }, spot: [0, 0] as [number, number], isMain: true, temp: false, runtime };
  const summary = statusSummary(state({ agents: [agent], startedAt: now - 3_600_000 }), 'auto', now);
  assert.ok(summary?.details.includes('**En arrière-plan :** 1 commande(s) en cours'));
  assert.ok(summary?.details.includes('- Mutation du lot 1 — Claude, depuis 8 h 21'));
});
