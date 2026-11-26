import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { discoverAgents } from '../src/discovery';
import { discoverGlobalAgents, samePath } from '../src/globalAgents';
import { CrewHub } from '../src/hub';
import { placeAgents } from '../src/layout';
import { applyAgentPatch, buildSettings } from '../src/settings';
import { SessionTracker } from '../src/tracker';
import { COPILOT_EXPLORER, COPILOT_ORCHESTRATOR, makeProject } from './helpers';

const agent = (name: string, description = `Agent ${name}.`) => `---\nname: ${name}\ndescription: ${description}\n---\nCorps.\n`;

/** Dossier de configuration Claude Code factice : plugin digiworks installé, agent personnel « veilleur ». */
function claudeHome(options: { installPath?: string; enabled?: Record<string, boolean>; extra?: Record<string, string>; installed?: unknown } = {}) {
  const home = makeProject({
    'agents/veilleur.md': agent('veilleur', 'Surveille les dépendances.'),
    'agents/perso/scribe.md': agent('scribe'),
    'agents/notes.md': '# Pas un agent\n',
    'plugins/cache/digiworks/digiworks/abc123/.claude-plugin/plugin.json': JSON.stringify({ name: 'digiworks' }),
    'plugins/cache/digiworks/digiworks/abc123/agents/testeur.md': agent('testeur', 'Lance les tests.'),
    'plugins/cache/digiworks/digiworks/abc123/agents/relecteur.md': agent('relecteur'),
    'plugins/cache/digiworks/digiworks/abc123/agents/revue/securite.md': agent('securite'),
    'plugins/cache/autre/outils/v1/agents/testeur.md': agent('testeur'),
    ...(options.enabled && { 'settings.json': JSON.stringify({ env: { SECRET: 'x' }, enabledPlugins: options.enabled }) }),
    ...options.extra,
  });
  const installPath = options.installPath ?? path.join(home, 'plugins/cache/digiworks/digiworks/abc123');
  const installed = options.installed ?? {
    version: 2,
    plugins: {
      'digiworks@digiworks': [{ scope: 'user', installPath, version: 'abc123' }],
      'outils@autre': [{ scope: 'project', projectPath: '/ailleurs/autre-projet', installPath: path.join(home, 'plugins/cache/autre/outils/v1'), version: 'v1' }],
    },
  };
  fs.writeFileSync(path.join(home, 'plugins/installed_plugins.json'), JSON.stringify(installed));
  return home;
}

test('agents globaux : agents personnels (sous-dossiers compris) et agents des plugins installés pour ce projet', () => {
  const home = claudeHome();
  const globals = discoverGlobalAgents(home, '/projet');
  assert.deepEqual(globals.map((g) => g.id).sort(), ['digiworks-relecteur', 'digiworks-revue-securite', 'digiworks-testeur', 'scribe', 'veilleur']);
  const testeur = globals.find((g) => g.id === 'digiworks-testeur')!;
  assert.equal(testeur.name, 'testeur');
  assert.deepEqual(testeur.global, { scope: 'plugin', plugin: 'digiworks' });
  assert.deepEqual(testeur.aliases, ['testeur']);
  assert.equal(testeur.source, path.join(home, 'plugins/cache/digiworks/digiworks/abc123/agents/testeur.md'));
  assert.equal(testeur.description, 'Lance les tests.');
  assert.equal(globals.find((g) => g.id === 'digiworks-revue-securite')!.name, 'revue:securite', 'les sous-dossiers entrent dans le nom');
  assert.deepEqual(globals.find((g) => g.id === 'veilleur')!.global, { scope: 'user' });
});

test('agents globaux : un plugin installé pour ce seul projet compte ici, pas ailleurs', () => {
  const home = claudeHome();
  assert.ok(discoverGlobalAgents(home, '/ailleurs/autre-projet').some((g) => g.id === 'outils-testeur'));
  assert.ok(!discoverGlobalAgents(home, '/projet').some((g) => g.id === 'outils-testeur'));
});

test('agents globaux : un plugin désactivé dans les réglages n’apparaît pas ; le projet peut le désactiver', () => {
  assert.ok(!discoverGlobalAgents(claudeHome({ enabled: { 'digiworks@digiworks': false } }), '/projet').some((g) => g.global?.scope === 'plugin'));
  const home = claudeHome({ enabled: { 'digiworks@digiworks': true } });
  assert.ok(discoverGlobalAgents(home, '/projet').some((g) => g.id === 'digiworks-testeur'));
  const root = makeProject({ '.claude/settings.local.json': JSON.stringify({ enabledPlugins: { 'digiworks@digiworks': false } }) });
  assert.ok(!discoverGlobalAgents(home, root).some((g) => g.id === 'digiworks-testeur'));
});

test('agents globaux : chemin d’installation introuvable (écrit sous WSL, lu sous Windows), retrouvé dans le cache', () => {
  const home = claudeHome({ installPath: '/home/quelquun/.claude/plugins/cache/digiworks/digiworks/abc123' });
  assert.ok(discoverGlobalAgents(home, '/projet').some((g) => g.id === 'digiworks-testeur'));
});

test('agents globaux : la clé « agents » du manifeste remplace le dossier agents/', () => {
  const home = claudeHome({
    extra: {
      'plugins/cache/digiworks/digiworks/abc123/.claude-plugin/plugin.json': JSON.stringify({ name: 'digiworks', agents: ['./autres/garde.md'] }),
      'plugins/cache/digiworks/digiworks/abc123/autres/garde.md': agent('garde'),
    },
  });
  const plugin = discoverGlobalAgents(home, '/projet').filter((g) => g.global?.scope === 'plugin');
  assert.deepEqual(plugin.map((g) => g.id), ['digiworks-garde']);
});

test('agents globaux : sans installed_plugins.json ni dossier agents, aucun agent global', () => {
  assert.deepEqual(discoverGlobalAgents(makeProject({}), '/projet'), []);
});

test('agents globaux : un agent du projet remplace l’agent personnel du même nom', () => {
  const home = claudeHome();
  const globals = discoverGlobalAgents(home, '/projet', ['veilleur']);
  assert.ok(!globals.some((g) => g.id === 'veilleur'));
  assert.ok(globals.some((g) => g.id === 'digiworks-testeur'), 'un agent de plugin garde son nom « digiworks:… »');
});

test('placement : les agents globaux occupent leur espace après la grille du projet, avant la table des intérimaires', () => {
  const root = makeProject({ '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR, '.github/agents/explorateur.agent.md': COPILOT_EXPLORER });
  const globals = discoverGlobalAgents(claudeHome(), root);
  const layout = placeAgents(discoverAgents(root), { agents: { 'digiworks-relecteur': { hidden: true }, 'digiworks-testeur': { label: 'Testeur' } } }, globals);
  const explorer = layout.agents.find((a) => a.id === 'explorateur')!;
  const placedGlobals = layout.agents.filter((a) => a.global);
  assert.equal(placedGlobals.length, 4, 'le relecteur masqué n’est pas placé');
  assert.ok(placedGlobals.every((a) => a.desk.y > explorer.desk.y && a.desk.kind === 'desk'));
  assert.ok(placedGlobals.every((a) => !a.temp && !a.isMain));
  assert.equal(placedGlobals.find((a) => a.id === 'digiworks-testeur')!.name, 'Testeur');
  const zone = layout.room.globalZone!;
  assert.ok(placedGlobals.every((a) => a.desk.y >= zone.y && a.desk.y + a.desk.d <= zone.y + zone.depth));
  assert.ok(layout.shared.y >= zone.y + zone.depth, 'la table des intérimaires vient après');
  const desks = new Set(layout.agents.map((a) => `${a.desk.x},${a.desk.y}`));
  assert.equal(desks.size, layout.agents.length, 'chacun son bureau');
  assert.equal(placeAgents(discoverAgents(root), {}).room.globalZone, undefined, 'sans agent global, pas d’espace');
});

test('hub : agents globaux dans la scène et les paramètres ; type « plugin:nom » ou nom court attribué au bon bureau', () => {
  const root = makeProject({ '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR, '.claude/agents/relecteur.md': agent('relecteur') });
  const home = claudeHome();
  const hub = new CrewHub({ root, claudeConfigDir: home });
  hub.reload();
  const scene = hub.snapshot().agents;
  const testeur = scene.find((a) => a.id === 'digiworks-testeur')!;
  assert.deepEqual(testeur.global, { scope: 'plugin', plugin: 'digiworks' });
  assert.equal(hub.sourceOf('digiworks-testeur'), path.join(home, 'plugins/cache/digiworks/digiworks/abc123/agents/testeur.md'));
  assert.equal(hub.sourceOf('relecteur'), path.join(root, '.claude/agents/relecteur.md'));

  assert.equal(hub.resolveAgentId('digiworks-testeur'), 'digiworks-testeur');
  assert.equal(hub.resolveAgentId('testeur'), 'digiworks-testeur', 'nom court d’un agent de plugin');
  assert.equal(hub.resolveAgentId('relecteur'), 'relecteur', 'le projet l’emporte sur le nom court du plugin');
  assert.equal(hub.resolveAgentId('digiworks-relecteur'), 'digiworks-relecteur', 'le nom complet désigne bien le plugin');
  assert.equal(hub.resolveAgentId('explore'), undefined);

  const settings = buildSettings(hub, { port: 4719, claudeConfigDir: home, themeDir: '', contextWindow: 'auto' });
  const entry = settings.agents.find((a) => a.id === 'digiworks-testeur')!;
  assert.equal(entry.slot, -1);
  assert.deepEqual(entry.global, { scope: 'plugin', plugin: 'digiworks' });
  hub.dispose();
});

test('suivi : une tâche confiée à « digiworks:testeur » occupe l’agent global, pas un intérimaire', () => {
  const ids = new Set(['main', 'digiworks-testeur']);
  const tracker = new SessionTracker(
    { mainId: () => 'main', has: (id) => ids.has(id), resolve: (id) => (ids.has(id) ? id : id === 'testeur' ? 'digiworks-testeur' : undefined), nameOf: () => undefined },
    { onChange: () => undefined, onMove: () => undefined },
  );
  const call = (id: string, type: string) => ({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: type, description: 'Tests' } }], stop_reason: 'tool_use' } });
  tracker.handleMain(call('t1', 'digiworks:testeur'));
  tracker.handleMain(call('t2', 'testeur'));
  tracker.handleMain(call('t3', 'Explore'));
  assert.equal(tracker.runtimeOf('digiworks-testeur').activeTasks, 2);
  assert.deepEqual(tracker.temps.map((t) => t.id), ['interim-explore']);
});

test('agents globaux : nom court retenu seulement sans ambiguïté, jamais celui d’un agent intégré', () => {
  const home = claudeHome({
    extra: { 'plugins/cache/digiworks/digiworks/abc123/agents/plan.md': agent('plan') },
    installed: {
      plugins: {
        'digiworks@digiworks': [{ scope: 'user', version: 'abc123' }],
        'outils@autre': [{ scope: 'user', version: 'v1' }],
      },
    },
  });
  const globals = discoverGlobalAgents(home, '/projet');
  const alias = (id: string) => globals.find((g) => g.id === id)!.aliases;
  assert.deepEqual(alias('digiworks-testeur'), [], 'deux plugins définissent « testeur »');
  assert.deepEqual(alias('outils-testeur'), []);
  assert.deepEqual(alias('digiworks-plan'), [], '« Plan » reste l’agent intégré');
  assert.deepEqual(alias('digiworks-relecteur'), ['relecteur']);
});

test('agents globaux : identifiant en double journalisé ; chemin du manifeste hors du plugin ignoré ; dossier listé accepté', () => {
  const lines: string[] = [];
  const home = claudeHome({
    extra: {
      'agents/digiworks-testeur.md': agent('digiworks-testeur'),
      'plugins/cache/digiworks/digiworks/abc123/.claude-plugin/plugin.json': JSON.stringify({ name: 'digiworks', agents: ['../../../../../agents/veilleur.md', './extra'] }),
      'plugins/cache/digiworks/digiworks/abc123/extra/garde.md': agent('garde'),
    },
  });
  const globals = discoverGlobalAgents(home, '/projet', [], (line) => lines.push(line));
  assert.deepEqual(globals.filter((g) => g.global?.scope === 'plugin').map((g) => g.id), ['digiworks-garde']);
  const dup = claudeHome({ extra: { 'agents/digiworks-testeur.md': agent('digiworks-testeur') } });
  const dupGlobals = discoverGlobalAgents(dup, '/projet', [], (line) => lines.push(line));
  assert.equal(dupGlobals.find((g) => g.id === 'digiworks-testeur')!.global?.scope, 'user', 'l’agent personnel passe avant le plugin');
  assert.ok(lines.some((l) => l.includes('digiworks-testeur') && l.includes('ignoré')));
});

test('agents globaux : JSON malformés sans effet ; agent personnel par lien symbolique', () => {
  const home = claudeHome({ extra: { 'settings.json': '{ pas du json', 'plugins/cache/digiworks/digiworks/abc123/.claude-plugin/plugin.json': '{' } });
  const globals = discoverGlobalAgents(home, '/projet');
  assert.ok(globals.some((g) => g.id === 'digiworks-testeur'), 'manifeste illisible : dossier agents/ et nom tiré de la clé');
  fs.writeFileSync(path.join(home, 'plugins/installed_plugins.json'), 'nul');
  assert.deepEqual(discoverGlobalAgents(home, '/projet').filter((g) => g.global?.scope === 'plugin'), []);

  const target = makeProject({ 'lien.md': agent('lie') });
  fs.symlinkSync(path.join(target, 'lien.md'), path.join(home, 'agents', 'lie.md'));
  assert.ok(discoverGlobalAgents(home, '/projet').some((g) => g.id === 'lie'));
});

test('chemins : un projet WSL et son chemin Windows se reconnaissent', () => {
  assert.ok(samePath('/mnt/c/DEV/projet', 'C:\\DEV\\projet'));
  assert.ok(samePath('C:\\dev\\Projet\\', '/mnt/c/dev/Projet'));
  assert.ok(samePath('/home/user/projet/', '/home/user/projet'));
  assert.ok(!samePath('/home/user/Projet', '/home/user/projet'), 'la casse compte hors lecteur Windows');
  assert.ok(!samePath('/mnt/c/DEV/a', 'C:\\DEV\\b'));
});

test('hub : un agent global masqué n’a pas de bureau et sa tâche passe à un intérimaire ; pas de poste pour un agent global', () => {
  const root = makeProject({
    '.github/agents/orchestrateur.agent.md': COPILOT_ORCHESTRATOR,
    '.github/agents/explorateur.agent.md': COPILOT_EXPLORER,
    '.crew-view/config.json': JSON.stringify({ agents: { 'digiworks-testeur': { hidden: true } } }),
  });
  const hub = new CrewHub({ root, claudeConfigDir: claudeHome() });
  hub.reload();
  assert.ok(!hub.snapshot().agents.some((a) => a.id === 'digiworks-testeur'));
  assert.equal(hub.resolveAgentId('digiworks-testeur'), undefined, 'le suivi en fera un intérimaire');
  const before = hub.snapshot().agents.find((a) => a.id === 'digiworks-relecteur')!.desk;
  applyAgentPatch(hub, 'digiworks-relecteur', { slot: 0, color: '#123456' });
  const after = hub.snapshot().agents.find((a) => a.id === 'digiworks-relecteur')!;
  assert.deepEqual([after.desk.x, after.desk.y], [before.x, before.y], 'le poste demandé est ignoré');
  assert.equal(after.color, '#123456', 'le reste du réglage s’applique');
  assert.equal(hub.snapshot().agents.find((a) => a.id === 'explorateur')!.desk.x, 1.4, 'l’occupant du poste ne bouge pas');
  hub.dispose();
});
