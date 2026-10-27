#!/usr/bin/env node
// Démo Crew View : une session Claude Code simulée, jouée en direct dans un projet de démonstration.
//
//   npm run demo                      scénario complet (≈ 2 min 30), puis l'open-space reste ouvert
//   npm run demo -- --loop            enchaîne les demandes en boucle
//   npm run demo -- --speed 2         deux fois plus vite
//   npm run demo -- --port 4800 --no-open
//
// Tout est écrit sous demo/ (projet fictif + dossier Claude isolé) : votre ~/.claude n'est jamais touché.
// Les transcripts suivent le format de Claude Code : l'open-space les lit exactement comme une vraie session.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'demo');
const PROJECT = path.join(DEMO, 'projet-candidatures');
const CLAUDE = path.join(DEMO, 'claude');
const CLI = path.join(ROOT, 'dist', 'cli.js');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const SPEED = Math.max(0.1, Number(option('--speed', '1')) || 1);
const PORT = option('--port', '4720');
const LOOP = args.includes('--loop');
const NO_OPEN = args.includes('--no-open');

const MODELS = { main: 'claude-opus-5-5', worker: 'claude-sonnet-5-5', explorer: 'claude-haiku-5-5' };

// ---- Projet de démonstration ------------------------------------------------------------------

const AGENTS = {
  'orchestrateur.agent.md': {
    name: 'Orchestrateur',
    description: "Point d'entrée : fait analyser la demande par l'Explorateur, répartit le travail entre Backend et Frontend, puis fait valider par la Revue Qualité.",
    tools: ['read', 'search', 'agent'],
    agents: ['Explorateur', 'Backend', 'Frontend', 'Revue Qualité'],
    body: "Tu es l'orchestrateur. Tu ne modifies rien toi-même : tu séquences le travail des agents spécialisés.",
  },
  'explorateur.agent.md': {
    name: 'Explorateur',
    description: "Analyse de l'existant et plan de travail argumenté. Ne modifie jamais aucun fichier.",
    tools: ['read', 'search'],
    body: "Tu analyses l'existant et proposes un plan découpé en lots.",
  },
  'backend.agent.md': {
    name: 'Backend',
    description: 'Implémentation API : routes, services, modèles, tests.',
    tools: ['read', 'search', 'edit', 'execute'],
    body: "Tu implémentes la partie API et tu publies le contrat utilisé par le front.",
  },
  'frontend.agent.md': {
    name: 'Frontend',
    description: 'Implémentation des composants du front (atomic design) et de leur intégration.',
    tools: ['read', 'search', 'edit', 'execute'],
    body: "Tu implémentes l'interface en t'appuyant sur le design system et sur le contrat d'API.",
  },
  'revue-qualite.agent.md': {
    name: 'Revue Qualité',
    description: 'Vérification accessibilité (RGAA), sécurité et design après implémentation.',
    tools: ['read', 'search'],
    body: 'Tu vérifies le travail livré et signales chaque anomalie.',
  },
};

function writeProject() {
  const dir = path.join(PROJECT, '.github', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, agent] of Object.entries(AGENTS)) {
    const list = (values) => `[${values.map((v) => (/[^a-z]/i.test(v) ? JSON.stringify(v) : v)).join(', ')}]`;
    const lines = ['---', `name: ${JSON.stringify(agent.name)}`, `description: ${JSON.stringify(agent.description)}`, `tools: ${list(agent.tools)}`];
    if (agent.agents) lines.push(`agents: ${list(agent.agents)}`);
    lines.push('---', agent.body, '');
    fs.writeFileSync(path.join(dir, file), lines.join('\n'));
  }
  fs.writeFileSync(path.join(PROJECT, 'AGENTS.md'), '# Projet de démonstration Crew View\n\nAgents : `.github/agents/*.agent.md`. Point d’entrée : Orchestrateur.\n');
}

// ---- Écriture des transcripts --------------------------------------------------------------------

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, (seconds * 1000) / SPEED));
const append = (file, record) => fs.appendFileSync(file, `${JSON.stringify({ ...record, timestamp: new Date().toISOString() })}\n`);
let sequence = 0;
const nextId = (prefix) => `${prefix}_demo_${(++sequence).toString(36)}`;
const hex = () => Math.random().toString(16).slice(2, 12).padEnd(10, '0');

/** Un intervenant qui écrit ses réponses dans un fichier de transcript (session principale ou subagent). */
class Actor {
  constructor(file, { model, context, sidechain = false, fileAgentId } = {}) {
    this.file = file;
    this.model = model;
    this.context = context;
    this.sidechain = sidechain;
    this.fileAgentId = fileAgentId;
  }

  base() {
    return this.sidechain ? { isSidechain: true, agentId: this.fileAgentId } : { isSidechain: false };
  }

  /** Une réponse du modèle, avec une consommation plausible : le contexte grossit à chaque appel. */
  reply(content, { stop = 'tool_use', output = 300, thinking = 0 } = {}) {
    const written = 600 + Math.round(Math.random() * 2400);
    append(this.file, {
      ...this.base(),
      type: 'assistant',
      message: {
        id: nextId('msg'),
        model: this.model,
        role: 'assistant',
        content,
        stop_reason: stop,
        usage: {
          input_tokens: 3 + Math.round(Math.random() * 6),
          cache_creation_input_tokens: written,
          cache_creation: { ephemeral_5m_input_tokens: written, ephemeral_1h_input_tokens: 0 },
          cache_read_input_tokens: this.context,
          output_tokens: output + thinking,
          output_tokens_details: { thinking_tokens: thinking },
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          speed: 'standard',
        },
      },
    });
    this.context += written + output;
  }

  async think(text, seconds) {
    this.reply([{ type: 'thinking', thinking: text, signature: '' }], { output: 40, thinking: 120 + text.length * 2 });
    await sleep(seconds);
  }

  async say(text, seconds, { end = false } = {}) {
    this.reply([{ type: 'text', text }], { stop: end ? 'end_turn' : 'tool_use', output: 60 + text.length });
    await sleep(seconds);
  }

  async tool(name, input, seconds) {
    const id = nextId('toolu');
    this.reply([{ type: 'tool_use', id, name, input }], { output: 90 + JSON.stringify(input).length });
    await sleep(seconds);
    this.result(id);
    return id;
  }

  /** Question à l'utilisateur : pas de résultat d'outil tant qu'il n'a pas répondu. */
  ask(question) {
    this.reply([{ type: 'tool_use', id: nextId('toolu'), name: 'AskUserQuestion', input: { questions: [{ question }] } }], { output: 80 + question.length });
  }

  result(id, toolUseResult) {
    append(this.file, { ...this.base(), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult });
  }
}

/** La session principale (l'orchestrateur) et ses délégations. */
class Session {
  constructor() {
    const slug = path.resolve(PROJECT).replace(/[^a-zA-Z0-9]/g, '-');
    const dir = path.join(CLAUDE, 'projects', slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'session-demo.jsonl');
    this.subdir = path.join(dir, 'session-demo', 'subagents');
    fs.mkdirSync(this.subdir, { recursive: true });
    fs.writeFileSync(this.file, '');
    this.main = new Actor(this.file, { model: MODELS.main, context: 32_000 });
  }

  title(text) {
    append(this.file, { type: 'ai-title', aiTitle: text });
  }

  async prompt(text, seconds) {
    log('Vous', text);
    append(this.file, { type: 'user', isSidechain: false, origin: { kind: 'human' }, promptId: nextId('prompt'), message: { role: 'user', content: [{ type: 'text', text }] } });
    await sleep(seconds);
  }

  /** Délégation par l'outil Agent ; `background` comme les subagents lancés en parallèle par Claude Code. */
  async delegate(type, description, seconds, { background = true, model = MODELS.worker } = {}) {
    log('Orchestrateur', `délègue à ${type} : ${description}`);
    const toolUseId = nextId('toolu');
    const fileAgentId = hex();
    this.main.reply([{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: type, description, prompt: description } }]);
    const file = path.join(this.subdir, `agent-${fileAgentId}.jsonl`);
    fs.writeFileSync(path.join(this.subdir, `agent-${fileAgentId}.meta.json`), JSON.stringify({ agentType: type, toolUseId, description }));
    append(file, { isSidechain: true, agentId: fileAgentId, type: 'user', message: { role: 'user', content: description } });
    if (background) this.main.result(toolUseId, { isAsync: true, status: 'async_launched', agentId: fileAgentId });
    const sub = new Actor(file, { model, context: 14_000, sidechain: true, fileAgentId });
    sub.toolUseId = toolUseId;
    sub.label = type;
    await sleep(seconds);
    return sub;
  }

  /** Fin d'un subagent en arrière-plan : Claude Code en notifie la session principale. */
  notify(sub) {
    log(sub.label, 'rend son rapport');
    append(this.file, {
      type: 'user',
      isSidechain: false,
      origin: { kind: 'task-notification' },
      message: { role: 'user', content: `<task-notification>\n<task-id>${sub.fileAgentId}</task-id>\n<tool-use-id>${sub.toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>` },
    });
  }

  /** Fin d'un subagent lancé au premier plan : le résultat revient dans l'appel de l'outil Agent. */
  complete(sub) {
    log(sub.label, 'rend son rapport');
    this.main.result(sub.toolUseId, { status: 'completed', agentId: sub.fileAgentId });
  }

  /** Relance d'un subagent existant (outil SendMessage). */
  async relaunch(sub, message, seconds) {
    log('Orchestrateur', `relance ${sub.label} : ${message}`);
    await this.main.tool('SendMessage', { to: sub.fileAgentId, message }, 0.2);
    append(sub.file, { isSidechain: true, agentId: sub.fileAgentId, type: 'user', message: { role: 'user', content: message } });
    await sleep(seconds);
  }
}

function log(who, text) {
  const time = new Date().toLocaleTimeString('fr-FR');
  console.log(`  ${time}  ${who.padEnd(14)} ${text}`);
}

// ---- Scénarios -----------------------------------------------------------------------------------

/** Demande complète : analyse, travail en parallèle, revue avec une anomalie, correction, validation. */
async function exportPdf(s) {
  const { main } = s;
  await s.prompt("Ajoute l'export PDF des candidatures, avec un bouton de téléchargement dans la fiche candidature.", 1.5);
  await main.think("Demande non triviale : je fais d'abord analyser l'existant par l'Explorateur, sans rien modifier.", 2.5);
  await main.say("Je confie l'analyse de l'existant à l'Explorateur avant toute modification.", 1);

  const explorer = await s.delegate('explorateur', "Analyser l'existant des candidatures", 3.5, { model: MODELS.explorer });
  await explorer.think('Je lis la documentation du projet, puis le modèle Candidature et la fiche côté front.', 2.5);
  await explorer.tool('Read', { file_path: `${PROJECT}/docs/architecture.md` }, 2.5);
  await explorer.tool('Grep', { pattern: 'class Candidature' }, 2);
  await explorer.tool('Read', { file_path: `${PROJECT}/backend/app/Models/Candidature.php` }, 2.5);
  await explorer.tool('Glob', { pattern: 'front/components/**/Fiche*.vue' }, 2);
  await explorer.tool('Read', { file_path: `${PROJECT}/front/components/organisms/FicheCandidature.vue` }, 2.5);
  await explorer.think("Deux lots indépendants : la route PDF côté API et le bouton côté front. Ils peuvent avancer en parallèle si le contrat d'API est partagé.", 3);
  await explorer.say("Plan : 1) Backend — route GET /api/candidatures/{id}/pdf et service PdfCandidature ; 2) Frontend — bouton « Télécharger le PDF » dans FicheCandidature. Lots parallélisables, contrat d'API à partager.", 1.5, { end: true });
  s.notify(explorer);
  await sleep(4.5);

  await main.think("Plan clair. Backend et Frontend en parallèle ; le Frontend s'appuiera sur le contrat publié par le Backend.", 2.5);
  await main.say('Analyse reçue. Je lance le Backend et le Frontend en parallèle.', 1);
  const backend = await s.delegate('backend', 'Route et service PDF des candidatures', 0.6);
  const frontend = await s.delegate('frontend', 'Bouton « Télécharger le PDF » dans la fiche', 4);

  let publishContract;
  const contract = new Promise((resolve) => (publishContract = resolve));

  await Promise.all([
    (async () => {
      await backend.think('Je pars du contrôleur existant pour ajouter la route.', 2);
      await backend.tool('Read', { file_path: `${PROJECT}/backend/app/Http/Controllers/CandidatureController.php` }, 2.5);
      await backend.tool('Write', { file_path: `${PROJECT}/backend/app/Services/PdfCandidature.php` }, 4);
      await backend.tool('Edit', { file_path: `${PROJECT}/backend/routes/api.php` }, 2.5);
      await backend.tool('Write', { file_path: `${PROJECT}/docs/contrat-api-pdf.md` }, 2);
      publishContract();
      await backend.tool('Bash', { command: 'php artisan test --filter=PdfCandidature', description: 'Lance les tests PdfCandidature' }, 6);
      await backend.say('Route GET /api/candidatures/{id}/pdf prête, 5 tests verts. Contrat publié dans docs/contrat-api-pdf.md.', 1, { end: true });
      s.notify(backend);
    })(),
    (async () => {
      await frontend.think('Je repère la fiche et les boutons du design system.', 2);
      await frontend.tool('Read', { file_path: `${PROJECT}/front/components/organisms/FicheCandidature.vue` }, 2.5);
      await frontend.tool('Glob', { pattern: 'front/components/atoms/Bouton*.vue' }, 2);
      await frontend.tool('Read', { file_path: `${PROJECT}/front/components/atoms/BoutonIcone.vue` }, 2.5);
      await frontend.think("J'attends le contrat d'API du Backend pour l'URL exacte de téléchargement.", 0.5);
      await contract;
      await frontend.tool('Read', { file_path: `${PROJECT}/docs/contrat-api-pdf.md` }, 2.5);
      await frontend.tool('Write', { file_path: `${PROJECT}/front/composables/useTelechargementPdf.ts` }, 3.5);
      await frontend.tool('Edit', { file_path: `${PROJECT}/front/components/organisms/FicheCandidature.vue` }, 3);
      await frontend.tool('Bash', { command: 'npm run build', description: 'Compile le front' }, 5);
      await frontend.say('Bouton ajouté dans la fiche (icône de téléchargement), build OK.', 1, { end: true });
      s.notify(frontend);
    })(),
  ]);
  await sleep(4);

  await main.think('Implémentation terminée des deux côtés : passage obligatoire en Revue Qualité.', 2);
  await main.say('Backend et Frontend ont terminé. Je passe la main à la Revue Qualité.', 1);
  const review = await s.delegate('revue-qualite', 'Revue accessibilité, sécurité et design', 3.5, { background: false });
  await review.tool('Read', { file_path: `${PROJECT}/front/components/organisms/FicheCandidature.vue` }, 2.5);
  await review.tool('Read', { file_path: `${PROJECT}/backend/app/Services/PdfCandidature.php` }, 2.5);
  await review.tool('Grep', { pattern: 'aria-label' }, 2);
  await review.think("Le bouton n'affiche qu'une icône : il n'a pas de nom accessible (RGAA 11.9). Côté API, l'accès est bien contrôlé.", 3);
  await review.say("1 anomalie : le bouton icône n'a pas de libellé accessible (RGAA 11.9). Backend : contrôle d'accès et nom de fichier conformes.", 1, { end: true });
  s.complete(review);
  await sleep(4.5);

  await main.think('Correction mineure côté Frontend, puis nouvelle revue.', 2.5);
  await s.relaunch(frontend, 'Ajoute un libellé accessible explicite au bouton de téléchargement.', 3.5);
  await frontend.tool('Edit', { file_path: `${PROJECT}/front/components/organisms/FicheCandidature.vue` }, 3);
  await frontend.say('Libellé accessible « Télécharger la candidature en PDF » ajouté.', 1, { end: true });
  s.notify(frontend);
  await sleep(4.5);

  await s.relaunch(review, 'Vérifie la correction du libellé accessible.', 3.5);
  await review.tool('Read', { file_path: `${PROJECT}/front/components/organisms/FicheCandidature.vue` }, 2.5);
  await review.say('Conforme : libellé accessible présent, aucune autre anomalie.', 1, { end: true });
  s.notify(review);
  await sleep(4.5);

  await main.say("C'est prêt : route PDF testée, bouton accessible, revue validée.", 2);
  log('Orchestrateur', 'vous pose une question');
  main.ask("Faut-il aussi proposer l'export groupé depuis la liste des candidatures ?");
}

/** Demande plus courte : pas d'analyse préalable, revue validée du premier coup. */
async function groupExport(s) {
  const { main } = s;
  await s.prompt("Oui, ajoute aussi l'export groupé depuis la liste.", 1.5);
  await main.think("Extension directe du travail précédent : pas besoin d'une nouvelle analyse.", 2);
  await main.say('Je relance le Backend et le Frontend en parallèle sur l’export groupé.', 1);
  const backend = await s.delegate('backend', 'Export groupé (archive ZIP de PDF)', 0.6);
  const frontend = await s.delegate('frontend', 'Sélection multiple et bouton d’export', 4);
  await Promise.all([
    (async () => {
      await backend.tool('Edit', { file_path: `${PROJECT}/backend/app/Services/PdfCandidature.php` }, 3);
      await backend.tool('Edit', { file_path: `${PROJECT}/backend/routes/api.php` }, 2);
      await backend.tool('Bash', { command: 'php artisan test --filter=ExportGroupe', description: 'Lance les tests ExportGroupe' }, 5);
      await backend.say('Route POST /api/candidatures/export prête, tests verts.', 1, { end: true });
      s.notify(backend);
    })(),
    (async () => {
      await frontend.tool('Read', { file_path: `${PROJECT}/front/components/organisms/ListeCandidatures.vue` }, 2.5);
      await frontend.tool('Edit', { file_path: `${PROJECT}/front/components/organisms/ListeCandidatures.vue` }, 4);
      await frontend.tool('Bash', { command: 'npm run build', description: 'Compile le front' }, 4);
      await frontend.say('Sélection multiple et bouton « Exporter la sélection » ajoutés.', 1, { end: true });
      s.notify(frontend);
    })(),
  ]);
  await sleep(4);
  const review = await s.delegate('revue-qualite', "Revue de l'export groupé", 3.5, { background: false });
  await review.tool('Read', { file_path: `${PROJECT}/front/components/organisms/ListeCandidatures.vue` }, 2.5);
  await review.think('Cases à cocher libellées, bouton désactivé sans sélection : conforme.', 2);
  await review.say('Conforme, aucune anomalie.', 1, { end: true });
  s.complete(review);
  await sleep(4.5);
  await main.say("Export groupé livré et validé par la Revue Qualité.", 1, { end: true });
}

// ---- Lancement ---------------------------------------------------------------------------------------

async function run() {
  if (!fs.existsSync(CLI)) {
    console.error('Crew View n’est pas compilé : lancez « npm run build » (ou « npm run demo »).');
    process.exit(1);
  }
  writeProject();
  const session = new Session();
  session.title('Export PDF des candidatures');

  const viewer = spawn(process.execPath, [CLI, PROJECT, '--claude-dir', CLAUDE, '--port', PORT, ...(NO_OPEN ? ['--no-open'] : [])], { stdio: 'inherit' });
  const stop = () => {
    viewer.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  viewer.on('exit', (code) => {
    if (code) process.exit(code);
  });

  console.log(`\nDémo : ${LOOP ? 'en boucle' : 'une demande complète'}, vitesse ×${SPEED}. Ctrl+C pour quitter.\n`);
  await sleep(3 * SPEED); // laisse le temps au navigateur de s'ouvrir, quelle que soit la vitesse
  const scenarios = [exportPdf, groupExport];
  for (let round = 0; ; round++) {
    await scenarios[round % scenarios.length](session);
    if (!LOOP) break;
    await sleep(8);
  }
  console.log('\nDémo terminée. L’open-space reste ouvert : Ctrl+C pour quitter.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
