import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionTracker } from '../src/tracker';

const KNOWN: Record<string, string> = { orchestrateur: 'Orchestrateur', explorateur: 'Explorateur' };

function setup() {
  const delegations: [string, string][] = [];
  const reports: [string, string][] = [];
  const tracker = new SessionTracker(
    { mainId: () => 'orchestrateur', has: (id) => id in KNOWN, nameOf: (id) => KNOWN[id] },
    { onChange: () => undefined, onMove: (m) => (m.kind === 'delegate' ? delegations.push([m.from, m.to]) : reports.push([m.from, m.to])) },
  );
  return { tracker, delegations, reports, status: (id: string) => tracker.runtimeOf(id).status };
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
  const { tracker, delegations, reports, status } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
  tracker.handleMain({ type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] }, toolUseResult: { isAsync: true, status: 'async_launched' } });
  assert.deepEqual(delegations, [['orchestrateur', 'explorateur']]);
  assert.equal(status('explorateur'), 'thinking', 'une tâche asynchrone lancée n’est pas terminée');

  tracker.registerSubagent('a1', { agentType: 'Explorateur', toolUseId: 't1' });
  tracker.handleSubagent('a1', assistant([{ type: 'tool_use', id: 's1', name: 'Read', input: { file_path: '/p/src/app.ts' } }]));
  assert.equal(status('explorateur'), 'reading');
  assert.deepEqual(tracker.runtimeOf('explorateur').files, ['/p/src/app.ts']);
  assert.equal(tracker.runtimeOf('explorateur').bubble?.text, 'Lit app.ts');

  assert.deepEqual(reports, []);
  tracker.handleMain({ type: 'user', timestamp: at(), origin: { kind: 'task-notification' }, message: { content: '<task-notification>\n<tool-use-id>t1</tool-use-id>' } });
  assert.equal(status('explorateur'), 'done');
  assert.deepEqual(reports, [['explorateur', 'orchestrateur']], 'l’agent va porter son rapport');
  tracker.handleMain({ type: 'user', timestamp: at(), origin: { kind: 'task-notification' }, message: { content: '<task-notification>\n<tool-use-id>t1</tool-use-id>' } });
  assert.equal(reports.length, 1, 'une seule fois par tâche');
});

test('un type d’agent inconnu devient un intérimaire', () => {
  const { tracker, delegations } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'Explore', description: 'Inventaire' } }]));
  assert.equal(tracker.temps.length, 1);
  assert.equal(tracker.temps[0].id, 'interim-explore');
  assert.equal(tracker.temps[0].name, 'Explore');
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
  // Contexte : dernière réponse de la session principale seulement (10 + 100 + 1000), pas celle du sous-agent.
  assert.deepEqual(tracker.context, { tokens: 1110, model: 'claude-opus-5-5' });
  assert.ok(tracker.startedAt !== undefined && tracker.lastActivityAt !== undefined && tracker.startedAt < tracker.lastActivityAt);
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

test('déplacements mémorisés : identifiants uniques, heure de lecture en direct, heure du transcript en relecture', () => {
  const { tracker } = setup();
  tracker.replaying = true;
  tracker.handleMain({ ...assistant([{ type: 'tool_use', id: 'old', name: 'Agent', input: { subagent_type: 'explorateur', description: 'Ancien' } }]), timestamp: '2020-01-01T00:00:00Z' });
  tracker.replaying = false;
  tracker.handleMain(assistant([{ type: 'tool_use', id: 'new', name: 'Agent', input: { subagent_type: 'explorateur', description: 'Nouveau' } }]));
  tracker.handleMain(assistant([{ type: 'tool_use', id: 'new', name: 'Agent', input: { subagent_type: 'explorateur', description: 'Doublon' } }]));
  assert.deepEqual(tracker.moves.map((m) => m.id), ['d:old', 'd:new']);
  assert.equal(tracker.moves[0].at, Date.parse('2020-01-01T00:00:00Z'));
  assert.ok(Date.now() - tracker.moves[1].at < 1000, 'en direct : heure de lecture');
});

test('relance d’un agent d’une session précédente : retrouvé par son type', () => {
  const moves: string[] = [];
  const tracker = new SessionTracker(
    { mainId: () => 'orchestrateur', has: (id) => id in KNOWN, nameOf: (id) => KNOWN[id], agentTypeOfFile: (id) => (id === 'ancien' ? 'Explorateur' : undefined) },
    { onChange: () => undefined, onMove: (m) => moves.push(`${m.kind}:${m.from}>${m.to}`) },
  );
  tracker.handleMain(assistant([{ type: 'tool_use', id: 'sm', name: 'SendMessage', input: { to: 'ancien', message: 'Reprends' } }]));
  assert.deepEqual(moves, ['delegate:orchestrateur>explorateur']);
  assert.equal(tracker.runtimeOf('explorateur').status, 'thinking');
});

test('commande en arrière-plan : suivie jusqu’à sa notification de fin, ou arrêtée par TaskStop', () => {
  const { tracker } = setup();
  const bash = (id: string, description: string) => assistant([{ type: 'tool_use', id, name: 'Bash', input: { command: 'make mutate', description, run_in_background: true } }]);
  const launched = (id: string, taskId: string) => ({ type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: ${taskId}. Output is being written to: /tmp/x` }] } });
  const notification = (id: string, taskId: string) => ({ type: 'user', timestamp: at(), origin: { kind: 'task-notification' }, message: { content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>` } });
  const background = () => tracker.runtimeOf('orchestrateur').background.map((b) => `${b.label}:${b.taskId}`);

  tracker.handleMain(bash('b1', 'Mutation du lot 1'));
  tracker.handleMain(launched('b1', 'bk1'));
  tracker.handleMain(bash('b2', 'Suite complète'));
  tracker.handleMain(launched('b2', 'bk2'));
  assert.deepEqual(background(), ['Mutation du lot 1:bk1', 'Suite complète:bk2']);

  tracker.handleMain(notification('b1', 'bk1'));
  assert.deepEqual(background(), ['Suite complète:bk2']);
  tracker.handleMain(assistant([{ type: 'tool_use', id: 's1', name: 'TaskStop', input: { task_id: 'bk2' } }]));
  assert.deepEqual(background(), []);

  // Résumé de fin de session : plusieurs task-id, uniquement en file d'attente.
  tracker.handleMain(bash('b4', 'Orpheline 1'));
  tracker.handleMain(launched('b4', 'bk4'));
  tracker.handleMain(bash('b5', 'Orpheline 2'));
  tracker.handleMain(launched('b5', 'bk5'));
  tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: '<task-notification>\n<task-id>bk4</task-id>\n<task-id>bk5</task-id>\n<status>stopped</status>\n</task-notification>' });
  assert.deepEqual(background(), []);

  tracker.handleMain(bash('b3', 'Sans fin'));
  tracker.handleMain(launched('b3', 'bk3'));
  tracker.sweep(Date.now() + 4 * 3_600_000);
  assert.deepEqual(background(), [], 'abandonnée après 3 h sans activité');
});

test('tâche asynchrone rendue par SubagentHandback : terminée, un seul rapport, puis au repos', () => {
  const { tracker, reports, status } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't7', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
  tracker.handleMain({ type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 't7' }] }, toolUseResult: { isAsync: true, status: 'async_launched' } });
  tracker.registerSubagent('a7', { agentType: 'Explorateur', toolUseId: 't7' });
  tracker.handleSubagent('a7', assistant([{ type: 'tool_use', id: 's7', name: 'Read', input: { file_path: '/p/a.ts' } }]));
  tracker.handleSubagent('a7', { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 's7' }] } });

  tracker.handleSubagent('a7', assistant([{ type: 'tool_use', id: 'h7', name: 'SubagentHandback', input: { message: 'Rapport' } }]));
  assert.equal(status('explorateur'), 'done', 'le rapport rendu clôt la tâche');
  assert.ok(tracker.runtimeOf('explorateur').history.some((h) => h.text === 'Rend son rapport'));
  tracker.handleSubagent('a7', { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 'h7', content: 'Report delivered' }] } });
  assert.equal(status('explorateur'), 'done', 'l’accusé de réception ne relance pas l’agent');

  const notification = `<task-notification>\n<task-id>a7</task-id>\n<tool-use-id>t7</tool-use-id>\n<status>completed</status>\n</task-notification>`;
  tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: notification });
  tracker.handleMain({ type: 'attachment', timestamp: at(), attachment: { type: 'queued_command', prompt: notification } });
  assert.deepEqual(reports, [['explorateur', 'orchestrateur']], 'un seul rapport malgré les signaux en double');

  tracker.sweep(Date.now() + 60_000);
  assert.equal(status('explorateur'), 'idle');
});

test('tâche asynchrone close par la seule notification en file (queue-operation ou attachment)', () => {
  for (const kind of ['queue-operation', 'attachment'] as const) {
    const { tracker, reports, status } = setup();
    tracker.handleMain(assistant([{ type: 'tool_use', id: 't8', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
    tracker.handleMain({ type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 't8' }] }, toolUseResult: { isAsync: true, status: 'async_launched' } });
    const notification = '<task-notification>\n<task-id>a8</task-id>\n<tool-use-id>t8</tool-use-id>\n</task-notification>';
    tracker.handleMain(kind === 'queue-operation'
      ? { type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: notification }
      : { type: 'attachment', timestamp: at(), attachment: { type: 'queued_command', prompt: notification } });
    assert.equal(status('explorateur'), 'done', kind);
    assert.equal(reports.length, 1, kind);
  }
});

test('relance par SendMessage après un SubagentHandback : la tâche se rouvre et rend un second rapport', () => {
  const { tracker, reports, status } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't6', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
  tracker.registerSubagent('a6', { agentType: 'Explorateur', toolUseId: 't6' });
  tracker.handleSubagent('a6', assistant([{ type: 'tool_use', id: 'h6', name: 'SubagentHandback', input: { message: 'Rapport' } }]));
  assert.equal(status('explorateur'), 'done');
  tracker.handleMain(assistant([{ type: 'tool_use', id: 'sm6', name: 'SendMessage', input: { to: 'a6', message: 'Précise' } }]));
  tracker.handleSubagent('a6', assistant([{ type: 'tool_use', id: 'r6', name: 'Read', input: { file_path: '/p/b.ts' } }]));
  tracker.handleSubagent('a6', { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 'r6' }] } });
  assert.equal(status('explorateur'), 'thinking', 'la tâche rouverte suit de nouveau son agent');
  tracker.handleSubagent('a6', assistant([{ type: 'tool_use', id: 'h6b', name: 'SubagentHandback', input: { message: 'Précision' } }]));
  assert.equal(status('explorateur'), 'done');
  assert.equal(reports.length, 2);
});

test('une notification relue (enqueue, remove, attachment) ne referme pas une tâche relancée entre-temps', () => {
  const { tracker, reports, status } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't5', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
  tracker.registerSubagent('a5', { agentType: 'Explorateur', toolUseId: 't5' });
  tracker.handleSubagent('a5', assistant([{ type: 'tool_use', id: 'h5', name: 'SubagentHandback', input: { message: 'Rapport' } }]));
  const first = '<task-notification>\n<task-id>a5</task-id>\n<tool-use-id>t5</tool-use-id>\n<usage>1</usage>\n</task-notification>';
  tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: first });
  tracker.handleMain(assistant([{ type: 'tool_use', id: 'sm5', name: 'SendMessage', input: { to: 'a5', message: 'Précise' } }]));
  tracker.handleMain({ type: 'attachment', timestamp: at(), attachment: { type: 'queued_command', prompt: first } });
  tracker.handleMain({ type: 'queue-operation', operation: 'remove', timestamp: at(), content: first });
  assert.equal(status('explorateur'), 'thinking', 'la même notification ne clôt qu’une fois');
  assert.equal(reports.length, 1);

  const second = first.replace('<usage>1</usage>', '<usage>2</usage>');
  tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: second });
  assert.equal(status('explorateur'), 'done', 'une nouvelle notification de la même tâche la clôt');
  assert.equal(reports.length, 2);
});

test('SubagentHandback lu après la notification : l’agent reste « terminé »', () => {
  const { tracker, reports, status } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't4', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
  tracker.registerSubagent('a4', { agentType: 'Explorateur', toolUseId: 't4' });
  tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: '<task-notification>\n<tool-use-id>t4</tool-use-id>\n</task-notification>' });
  tracker.handleSubagent('a4', assistant([{ type: 'tool_use', id: 'h4', name: 'SubagentHandback', input: { message: 'Rapport' } }]));
  assert.equal(status('explorateur'), 'done');
  assert.equal(reports.length, 1);
});

test('un message en file qui cite une notification sans en être une ne clôt rien', () => {
  const { tracker, status } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't3b', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
  tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: 'Regarde ça : <task-notification><tool-use-id>t3b</tool-use-id></task-notification>' });
  assert.equal(status('explorateur'), 'thinking');
});

test('mémoire des notifications bornée : seules les 100 dernières sont retenues', () => {
  const { tracker, reports, status } = setup();
  tracker.handleMain(assistant([{ type: 'tool_use', id: 't0', name: 'Agent', input: { subagent_type: 'Explorateur', description: 'Analyser' } }]));
  tracker.registerSubagent('a0', { agentType: 'Explorateur', toolUseId: 't0' });
  const first = '<task-notification>\n<tool-use-id>t0</tool-use-id>\n</task-notification>';
  tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: first });
  for (let i = 0; i < 100; i++) tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: `<task-notification>\n<task-id>bash${i}</task-id>\n</task-notification>` });
  tracker.handleMain(assistant([{ type: 'tool_use', id: 'sm0', name: 'SendMessage', input: { to: 'a0', message: 'Précise' } }]));
  tracker.handleMain({ type: 'queue-operation', operation: 'enqueue', timestamp: at(), content: first });
  assert.equal(status('explorateur'), 'done', 'la plus ancienne a été oubliée');
  assert.equal(reports.length, 2);
});
