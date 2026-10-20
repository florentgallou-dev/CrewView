import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionTracker } from '../src/tracker';

const KNOWN: Record<string, string> = { orchestrateur: 'Orchestrateur', explorateur: 'Explorateur' };

function setup() {
  const delegations: [string, string, string][] = [];
  const tracker = new SessionTracker(
    { mainId: () => 'orchestrateur', has: (id) => id in KNOWN, nameOf: (id) => KNOWN[id] },
    { onChange: () => undefined, onDelegate: (from, to, label) => delegations.push([from, to, label]) },
  );
  return { tracker, delegations, status: (id: string) => tracker.runtimeOf(id).status };
}

let seq = 0;
const at = () => new Date(Date.now() - 1000 + seq++).toISOString();
const assistant = (content: unknown[], stop = 'tool_use', id = `m${seq}`) => ({ type: 'assistant', timestamp: at(), message: { id, content, stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } } });
const human = (text: string) => ({ type: 'user', timestamp: at(), origin: { kind: 'human' }, message: { content: [{ type: 'text', text: '<ide_selection>bruit</ide_selection>' }, { type: 'text', text }] } });

test('une demande met l’agent principal en réflexion et alimente le dialogue', () => {
  const { tracker, status } = setup();
  tracker.handleMain(human('Ajoute un bouton PDF'));
  assert.equal(status('orchestrateur'), 'thinking');
  assert.equal(tracker.dialog?.speaker, 'Vous');
  assert.equal(tracker.dialog?.text, 'Ajoute un bouton PDF');
});

test('délégation à un agent du projet : animation, tâche, puis fin via la notification', () => {
  const { tracker, delegations, status } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
  tracker.handleMain({ type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] }, toolUseResult: { isAsync: true, status: 'async_launched' } });
  assert.deepEqual(delegations, [['orchestrateur', 'explorateur', 'Analyser']]);
  assert.equal(status('explorateur'), 'thinking', 'une tâche asynchrone lancée n’est pas terminée');

  tracker.registerSubagent('a1', { agentType: 'Explorateur', toolUseId: 't1' });
  tracker.handleSubagent('a1', assistant([{ type: 'tool_use', id: 's1', name: 'Read', input: { file_path: '/p/src/app.ts' } }]));
  assert.equal(status('explorateur'), 'reading');
  assert.deepEqual(tracker.runtimeOf('explorateur').files, ['/p/src/app.ts']);
  assert.equal(tracker.runtimeOf('explorateur').bubble?.text, 'Lit app.ts');

  tracker.handleMain({ type: 'user', timestamp: at(), origin: { kind: 'task-notification' }, message: { content: '<task-notification>\n<tool-use-id>t1</tool-use-id>' } });
  assert.equal(status('explorateur'), 'done');
});

test('un type d’agent inconnu devient un intérimaire', () => {
  const { tracker, delegations } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'Explore', description: 'Inventaire' } }]));
  assert.equal(tracker.temps.length, 1);
  assert.equal(tracker.temps[0].id, 'interim-explore');
  assert.equal(tracker.temps[0].temp, true);
  assert.equal(delegations[0][1], 'interim-explore');
});

test('un subagent qui termine son tour passe à « terminé »', () => {
  const { tracker, status } = setup();
  tracker.registerSubagent('a2', { agentType: 'explorateur', toolUseId: 't3', description: 'Lire' });
  tracker.handleSubagent('a2', assistant([{ type: 'text', text: '## Résultat\n**Tout** va bien' }], 'end_turn'));
  assert.equal(status('explorateur'), 'done');
  const history = tracker.runtimeOf('explorateur').history;
  assert.equal(history.at(-2)?.text, 'Résultat Tout va bien', 'le markdown est retiré des bulles');
});

test('les tokens d’un message découpé en plusieurs blocs ne sont comptés qu’une fois', () => {
  const { tracker } = setup();
  tracker.handleMain(assistant([{ type: 'thinking', thinking: '' }], 'tool_use', 'same'));
  tracker.handleMain(assistant([{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } }], 'tool_use', 'same'));
  assert.equal(tracker.runtimeOf('orchestrateur').usage.output, 5);
  assert.equal(tracker.runtimeOf('orchestrateur').usage.calls, 1);
  assert.equal(tracker.runtimeOf('orchestrateur').status, 'running');
});

test('bilan par demande : un subagent est imputé à la demande qui l’a lancé, même s’il finit après le prompt suivant', () => {
  const { tracker } = setup();
  const usage = (output: number, extra: object = {}) => ({ input_tokens: 10, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 }, cache_read_input_tokens: 1000, output_tokens: output, output_tokens_details: { thinking_tokens: 2 }, ...extra });
  const reply = (id: string, content: unknown[], u: object) => ({ type: 'assistant', timestamp: at(), message: { id, model: 'claude-opus-5-5', content, stop_reason: 'tool_use', usage: u } });

  tracker.handleMain(human('Première demande'));
  tracker.handleMain(reply('a1', [{ type: 'tool_use', id: 't9', name: 'Agent', input: { subagent_type: 'explorateur', description: 'Analyser' } }], usage(7)));
  tracker.registerSubagent('s9', { agentType: 'explorateur', toolUseId: 't9' });
  tracker.handleMain(human('Deuxième demande'));
  tracker.handleSubagent('s9', reply('b1', [{ type: 'text', text: 'ok' }], usage(30, { server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } })));
  tracker.handleMain(reply('a2', [{ type: 'text', text: 'Voilà' }], usage(11)));

  const [first, second] = tracker.requests;
  assert.equal(first.prompt, 'Première demande');
  assert.equal(first.total.output, 37, 'orchestrateur 7 + explorateur 30');
  assert.equal(first.byAgent.explorateur.output, 30);
  assert.equal(first.byAgent.explorateur.webSearches, 2);
  assert.equal(first.byAgent.explorateur.webFetches, 1);
  assert.equal(second.total.output, 11);
  assert.equal(second.total.cacheWrite5m, 60);
  assert.equal(second.total.cacheWrite1h, 40);
  assert.equal(second.total.thinking, 2);
  assert.deepEqual(second.total.models, { 'claude-opus-5-5': 1 });
  // Opus 5.5 : 10 × 4 + 60 × 5 + 40 × 8 + 1000 × 0,20 + 11 × 20, par million de tokens.
  assert.ok(Math.abs(second.total.costUsd - (10 * 4 + 60 * 5 + 40 * 8 + 1000 * 0.2 + 11 * 20) / 1e6) < 1e-12);
  assert.equal(tracker.runtimeOf('explorateur').usage.calls, 1);
});

test('coût réel de la session lu dans l’enregistrement cost-state', () => {
  const { tracker } = setup();
  tracker.handleMain({ type: 'cost-state', totalCostUSD: 5.96, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 304, outputTokens: 161051, cacheReadInputTokens: 17600709, cacheCreationInputTokens: 905531, webSearchRequests: 0, costUSD: 5.9 } } });
  assert.equal(tracker.sessionCost?.totalUsd, 5.96);
  assert.deepEqual(tracker.sessionCost?.byModel[0], { model: 'claude-sonnet-5-5', costUsd: 5.9, inputTokens: 304, outputTokens: 161051, cacheReadTokens: 17600709, cacheWriteTokens: 905531, webSearches: 0 });
});

test('fin de tour de la session principale, puis retour au repos', () => {
  const { tracker, status } = setup();
  tracker.handleMain(assistant([{ type: 'text', text: 'Voilà.' }], 'end_turn'));
  assert.equal(status('orchestrateur'), 'done');
  tracker.sweep(Date.now() + 60_000);
  assert.equal(status('orchestrateur'), 'idle');
});

test('après relecture, une session ancienne est au repos', () => {
  const { tracker, status } = setup();
  tracker.handleMain({ ...assistant([{ type: 'tool_use', id: 'b', name: 'Bash', input: {} }]), timestamp: '2020-01-01T00:00:00Z' });
  tracker.settle(Date.now());
  assert.equal(status('orchestrateur'), 'idle');
});
