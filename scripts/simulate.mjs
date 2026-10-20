// Démo : simule une session Claude Code en écrivant des transcripts au fil de l'eau.
// Usage : node scripts/simulate.mjs <dossier-projet> <dossier-claude-de-démo>
// puis    node dist/cli.js <dossier-projet> --claude-dir <dossier-claude-de-démo>
// N'utilisez pas votre vrai ~/.claude : le dossier de session simulée est effacé à chaque lancement.
// Les types d'agents simulés correspondent à l'exemple Matmut (explorateur, backend-laravel, Revue Qualité).
import fs from 'node:fs';
import path from 'node:path';

const [, , root, claudeDir] = process.argv;
if (!root || !claudeDir) {
  console.error('Usage : node scripts/simulate.mjs <dossier-projet> <dossier-claude-de-démo>');
  process.exit(1);
}
const slug = path.resolve(root).replace(/[^a-zA-Z0-9]/g, '-');
const dir = path.join(claudeDir, 'projects', slug);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const sid = 'demo-session';
const main = path.join(dir, `${sid}.jsonl`);
const subdir = path.join(dir, sid, 'subagents');
fs.mkdirSync(subdir, { recursive: true });
fs.writeFileSync(main, '');

const write = (file, rec) => fs.appendFileSync(file, JSON.stringify({ ...rec, timestamp: new Date().toISOString() }) + '\n');
let n = 0;
const assistant = (content, stop = 'tool_use') => ({ type: 'assistant', message: { id: `msg_${++n}`, role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 120, output_tokens: 300 + n * 7, cache_read_input_tokens: 8000 } } });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (id, extra) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult: extra });
const notify = (id) => write(main, { type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>` } });
const sub = (id) => path.join(subdir, `agent-${id}.jsonl`);
const spawn = (agentId, toolUseId, type, description) => {
  fs.writeFileSync(path.join(subdir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: type, toolUseId, description }));
  write(sub(agentId), { type: 'user', isSidechain: true, message: { role: 'user', content: description } });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const timeline = [
  [0, () => {
    write(main, { type: 'ai-title', aiTitle: 'Bouton PDF sur les appels à projets' });
    write(main, { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: '<ide_opened_file>x</ide_opened_file>' }, { type: 'text', text: "Ajoute un bouton sur la fiche d'un appel à projets pour télécharger le PDF." }] } });
  }],
  [1.5, () => write(main, assistant([{ type: 'thinking', thinking: "Demande non triviale : je fais d'abord analyser l'existant par l'Explorateur, et j'inventorie les ressources Nova en parallèle." }]))],
  [4, () => {
    write(main, assistant([tool('t1', 'Agent', { subagent_type: 'explorateur', description: 'Analyser la ressource CallForProject', prompt: '…' })]));
    write(main, result('t1', { isAsync: true, status: 'async_launched' }));
    spawn('x1', 't1', 'explorateur', 'Analyser la ressource CallForProject');
  }],
  [5, () => {
    write(main, assistant([tool('t2', 'Agent', { subagent_type: 'Explore', description: 'Inventaire des actions Nova', prompt: '…' })]));
    write(main, result('t2', { isAsync: true, status: 'async_launched' }));
    spawn('x2', 't2', 'Explore', 'Inventaire des actions Nova');
  }],
  [6, () => write(sub('x1'), assistant([{ type: 'thinking', thinking: 'Je commence par instructions-project.md, puis la ressource Nova.' }]))],
  [7, () => write(sub('x1'), assistant([tool('s1', 'Read', { file_path: '/p/instructions-project.md' })]))],
  [8, () => write(sub('x2'), assistant([tool('s2', 'Glob', { pattern: 'app/Nova/Actions/**/*.php' })]))],
  [9.5, () => write(sub('x1'), assistant([tool('s3', 'Grep', { pattern: 'class CallForProject' })]))],
  [10.5, () => write(sub('x2'), assistant([tool('s4', 'Read', { file_path: '/p/app/Nova/Actions/ExportPdf.php' })]))],
  [12, () => write(sub('x1'), assistant([{ type: 'text', text: 'La ressource CallForProject expose déjà un champ `pdf_path` : il suffit d’ajouter une action Nova.' }], 'end_turn'))],
  [12.5, () => notify('t1')],
  [13.5, () => write(sub('x2'), assistant([{ type: 'text', text: '3 actions Nova existantes, dont une ExportPdf réutilisable.' }], 'end_turn'))],
  [14, () => notify('t2')],
  [15, () => write(main, assistant([{ type: 'text', text: "L'analyse est faite : on réutilise l'action ExportPdf. Je confie l'implémentation au Backend Laravel et la vérification à la Revue Qualité." }]))],
  [17, () => {
    write(main, assistant([tool('t3', 'Agent', { subagent_type: 'backend-laravel', description: 'Action Nova « Télécharger le PDF »', prompt: '…' })]));
    spawn('x3', 't3', 'backend-laravel', 'Action Nova « Télécharger le PDF »');
  }],
  [18.5, () => write(sub('x3'), assistant([tool('s5', 'Read', { file_path: '/p/app/Nova/CallForProject.php' })]))],
  [20, () => write(sub('x3'), assistant([tool('s6', 'Edit', { file_path: '/p/app/Nova/CallForProject.php' })]))],
  [22, () => write(sub('x3'), assistant([tool('s7', 'Write', { file_path: '/p/app/Nova/Actions/DownloadPdf.php' })]))],
  [24, () => write(sub('x3'), assistant([tool('s8', 'Bash', { command: 'php artisan test --filter=CallForProject', description: 'Lance les tests CallForProject' })]))],
  [28, () => write(sub('x3'), assistant([{ type: 'text', text: 'Action ajoutée et testée (4 tests verts).' }], 'end_turn'))],
  [28.5, () => write(main, result('t3', { status: 'completed' }))],
  [29.5, () => {
    write(main, assistant([tool('t4', 'Agent', { subagent_type: 'Revue Qualité', description: 'Revue a11y et sécurité du bouton PDF', prompt: '…' })]));
    spawn('x4', 't4', 'Revue Qualité', 'Revue a11y et sécurité du bouton PDF');
  }],
  [31, () => write(sub('x4'), assistant([tool('s9', 'Read', { file_path: '/p/app/Nova/Actions/DownloadPdf.php' })]))],
  [33, () => write(sub('x4'), assistant([{ type: 'thinking', thinking: 'Le nom du fichier vient de la base : vérifier qu’il ne permet pas de sortir du dossier de stockage.' }]))],
  [36, () => write(sub('x4'), assistant([{ type: 'text', text: 'RAS : libellé accessible, chemin validé.' }], 'end_turn'))],
  [36.5, () => write(main, result('t4', { status: 'completed' }))],
  [37.5, () => write(main, assistant([tool('q1', 'AskUserQuestion', { questions: [{ question: 'Le bouton doit-il aussi apparaître dans la liste ?' }] })]))],
];

const start = Date.now();
for (const [at, step] of timeline) {
  const wait = start + at * 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  step();
}
console.log('Simulation terminée.');
