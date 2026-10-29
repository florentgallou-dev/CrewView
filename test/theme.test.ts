import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { CrewHub } from '../src/hub';
import { copyDefaultTheme, PROJECT_THEME_DIR, readTheme, themeSignature, themeSources } from '../src/theme';
import { THEME_FILES } from '../src/themeFiles';
import type { HostMessage } from '../src/types';
import { makeProject } from './helpers';

const DEFAULT_DIR = path.resolve('resources/theme');

test('le thème par défaut contient tous les fichiers, chaque SVG avec un viewBox', () => {
  for (const name of THEME_FILES) {
    const content = fs.readFileSync(path.join(DEFAULT_DIR, name), 'utf8');
    if (name.endsWith('.json')) {
      const pivots = JSON.parse(content);
      assert.ok(Array.isArray(pivots.epaule) && pivots.longueurs.bras > 0, name);
    } else {
      assert.match(content, /<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="[-\d. ]+"/, name);
    }
  }
});

test('le projet prime sur le dossier global, qui prime sur le thème par défaut', () => {
  const root = makeProject({ [`${PROJECT_THEME_DIR}/mobilier/bureau.svg`]: '<svg projet/>' });
  const global = makeProject({ 'mobilier/bureau.svg': '<svg global/>', 'decor/sol.svg': '<svg sol-global/>', 'notes.txt': 'ignoré' });
  const sources = themeSources(root, global, DEFAULT_DIR);
  assert.deepEqual(sources.map((s) => s.label), ['projet', 'global', 'défaut']);
  const layers = readTheme(sources);
  const resolve = (name: string) => layers.find((layer) => layer[name])?.[name];
  assert.equal(resolve('mobilier/bureau.svg'), '<svg projet/>');
  assert.equal(resolve('decor/sol.svg'), '<svg sol-global/>');
  assert.match(resolve('personnage/tete.svg') ?? '', /<circle/);
  assert.equal(Object.keys(layers[1]).length, 2, 'seuls les fichiers connus sont lus');
  assert.deepEqual(themeSources(root, ' ', DEFAULT_DIR).map((s) => s.label), ['projet', 'défaut']);
});

test("l'empreinte du thème change quand un fichier est ajouté ou modifié", () => {
  const root = makeProject({});
  const sources = themeSources(root, undefined, DEFAULT_DIR);
  const before = themeSignature(sources);
  const file = path.join(root, PROJECT_THEME_DIR, 'decor/plante.svg');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '<svg/>');
  const added = themeSignature(sources);
  assert.notEqual(added, before);
  fs.writeFileSync(file, '<svg viewBox="0 0 2 2"/>');
  assert.notEqual(themeSignature(sources), added);
});

test('personnaliser copie le thème par défaut sans écraser les fichiers du projet', () => {
  const root = makeProject({ [`${PROJECT_THEME_DIR}/decor/sol.svg`]: '<svg perso/>' });
  const copied = copyDefaultTheme(root, DEFAULT_DIR);
  assert.equal(copied.length, THEME_FILES.length - 1);
  assert.equal(fs.readFileSync(path.join(root, PROJECT_THEME_DIR, 'decor/sol.svg'), 'utf8'), '<svg perso/>');
  assert.ok(fs.existsSync(path.join(root, PROJECT_THEME_DIR, 'README.md')));
  assert.deepEqual(copyDefaultTheme(root, DEFAULT_DIR), []);
});

test('le hub envoie le thème à chaque vue qui se connecte', () => {
  const root = makeProject({ [`${PROJECT_THEME_DIR}/decor/sol.svg`]: '<svg perso/>' });
  const hub = new CrewHub({ root, claudeConfigDir: makeProject({}), defaultThemeDir: DEFAULT_DIR });
  hub.start();
  const messages: HostMessage[] = [];
  hub.subscribe((m) => messages.push(m));
  hub.dispose();
  const theme = messages.find((m) => m.type === 'theme');
  assert.ok(theme && theme.type === 'theme');
  assert.equal(theme.layers[0]['decor/sol.svg'], '<svg perso/>');
  assert.equal(Object.keys(theme.layers[theme.layers.length - 1]).length, THEME_FILES.length);
});
