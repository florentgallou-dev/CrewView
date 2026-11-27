import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { SessionWatcher } from '../src/session';
import { SessionTracker } from '../src/tracker';

test('relecture : la notification de fin, écrite dans le fichier principal, passe après les derniers messages du subagent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-view-session-'));
  const now = Date.now();
  // Fin de tâche 2 s avant « maintenant » : l'état « terminé » (6 s) est encore visible.
  const ts = (offset: number) => new Date(now - 7_000 + offset * 1000).toISOString();
  const line = (record: object) => `${JSON.stringify(record)}\n`;

  fs.writeFileSync(path.join(dir, 's1.jsonl'),
    line({ type: 'assistant', timestamp: ts(0), message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'explorateur', description: 'Analyser' } }] } }) +
    line({ type: 'user', timestamp: ts(0.1), message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] }, toolUseResult: { isAsync: true } }) +
    line({ type: 'user', timestamp: ts(5), origin: { kind: 'task-notification' }, message: { content: '<task-notification>\n<tool-use-id>t1</tool-use-id>' } }));
  const subdir = path.join(dir, 's1', 'subagents');
  fs.mkdirSync(subdir, { recursive: true });
  fs.writeFileSync(path.join(subdir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'explorateur', toolUseId: 't1' }));
  fs.writeFileSync(path.join(subdir, 'agent-a1.jsonl'),
    line({ type: 'assistant', timestamp: ts(2), message: { id: 's1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.ts' } }] } }) +
    line({ type: 'assistant', timestamp: ts(4.9), message: { id: 's2', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fini.' }] } }));

  let tracker: SessionTracker | undefined;
  const watcher = new SessionWatcher(
    dir,
    () => new SessionTracker({ mainId: () => 'main', has: (id) => id === 'explorateur', nameOf: () => undefined }, { onChange: () => undefined, onMove: () => undefined }),
    (attached) => (tracker = attached),
  );
  watcher.start();
  watcher.dispose();

  assert.ok(tracker, 'session attachée');
  const runtime = tracker.runtimeOf('explorateur');
  assert.equal(runtime.status, 'done');
  assert.equal(runtime.activeTasks, 0);
  assert.deepEqual(runtime.history.map((h) => h.text), ['Reçoit : Analyser', 'Lit a.ts', 'Fini.', 'Tâche terminée']);
});

test('session imposée par l’hôte : suivie même si une autre est plus récente, puis retour au suivi automatique', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-view-session-'));
  const line = (record: object) => `${JSON.stringify(record)}\n`;
  const write = (name: string, ageMs: number) => {
    const file = path.join(dir, `${name}.jsonl`);
    fs.writeFileSync(file, line({ type: 'user', timestamp: new Date(Date.now() - ageMs).toISOString(), message: { content: name } }));
    const at = new Date(Date.now() - ageMs);
    fs.utimesSync(file, at, at);
  };
  // « longue » : silencieuse (commande longue) ; « courte » : une autre conversation qui vient d'écrire.
  write('longue', 120_000);
  write('courte', 1_000);

  const attached: string[] = [];
  const watcher = new SessionWatcher(
    dir,
    () => new SessionTracker({ mainId: () => 'main', has: () => false, nameOf: () => undefined }, { onChange: () => undefined, onMove: () => undefined }),
    (_tracker, sessionId) => attached.push(sessionId),
  );
  watcher.follow('longue');
  watcher.start();
  assert.deepEqual(attached, ['longue'], 'la session imposée est suivie, pas la plus récente');

  // Une nouvelle conversation apparaît : la session imposée reste suivie.
  write('nouvelle', 0);
  watcher.follow('longue');
  assert.deepEqual(attached, ['longue']);

  // Plus de session imposée : retour à la plus récente.
  watcher.follow(undefined);
  watcher.dispose();
  assert.deepEqual(attached, ['longue', 'nouvelle']);
});

test('session imposée pas encore écrite : suivi automatique en attendant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-view-session-'));
  fs.writeFileSync(path.join(dir, 'autre.jsonl'), `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: 'x' } })}\n`);
  const attached: string[] = [];
  const watcher = new SessionWatcher(
    dir,
    () => new SessionTracker({ mainId: () => 'main', has: () => false, nameOf: () => undefined }, { onChange: () => undefined, onMove: () => undefined }),
    (_tracker, sessionId) => attached.push(sessionId),
  );
  watcher.follow('absente');
  watcher.start();
  watcher.dispose();
  assert.deepEqual(attached, ['autre']);
});

test('session imposée levée : la plus récente est suivie tout de suite, même si l’imposée vient d’écrire', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-view-session-'));
  const write = (name: string, ageMs: number) => {
    const file = path.join(dir, `${name}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: 'user', timestamp: new Date(Date.now() - ageMs).toISOString(), message: { content: name } })}\n`);
    const at = new Date(Date.now() - ageMs);
    fs.utimesSync(file, at, at);
  };
  write('imposee', 2_000);
  write('recente', 500);
  const attached: string[] = [];
  const watcher = new SessionWatcher(
    dir,
    () => new SessionTracker({ mainId: () => 'main', has: () => false, nameOf: () => undefined }, { onChange: () => undefined, onMove: () => undefined }),
    (_tracker, sessionId) => attached.push(sessionId),
  );
  watcher.follow('imposee');
  watcher.start();
  watcher.follow(undefined);
  watcher.dispose();
  assert.deepEqual(attached, ['imposee', 'recente']);
});
