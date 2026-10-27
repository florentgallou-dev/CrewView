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
    () => new SessionTracker({ mainId: () => 'main', has: (id) => id === 'explorateur', nameOf: () => undefined }, { onChange: () => undefined, onDelegate: () => undefined, onReport: () => undefined }),
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
