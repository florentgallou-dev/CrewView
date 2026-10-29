// Thème graphique : fichiers SVG lus dans le projet, dans un dossier global, puis dans le thème par défaut.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { THEME_FILES, type ThemeLayers } from './themeFiles';

/** Dossier du thème propre au projet (prioritaire). */
export const PROJECT_THEME_DIR = '.crew-view/theme';
const MAX_FILE_BYTES = 512 * 1024;

/** Thème livré avec l'extension (`resources/theme`, à côté de `dist/`). */
export function defaultThemeDir(): string {
  return path.join(__dirname, '..', 'resources', 'theme');
}

export interface ThemeSource {
  label: string;
  dir: string;
}

/** Dossiers du thème, du plus prioritaire au moins prioritaire. */
export function themeSources(root: string, globalDir: string | undefined, defaultDir: string): ThemeSource[] {
  const sources: ThemeSource[] = [{ label: 'projet', dir: path.join(root, PROJECT_THEME_DIR) }];
  if (globalDir?.trim()) sources.push({ label: 'global', dir: path.resolve(globalDir.trim()) });
  sources.push({ label: 'défaut', dir: defaultDir });
  return sources;
}

/** Fichiers connus d'un dossier de thème (les autres sont ignorés). */
export function readThemeDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of THEME_FILES) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      files[name] = fs.readFileSync(file, 'utf8');
    } catch {
      // Absent : la couche suivante fournit le fichier.
    }
  }
  return files;
}

export function readTheme(sources: ThemeSource[]): ThemeLayers {
  return sources.map((source) => readThemeDir(source.dir));
}

/** Empreinte (taille, date) des fichiers connus : change dès qu'un fichier est ajouté, modifié ou supprimé. */
export function themeSignature(sources: ThemeSource[]): string {
  const parts: string[] = [];
  for (const source of sources) {
    for (const name of THEME_FILES) {
      try {
        const stat = fs.statSync(path.join(source.dir, name));
        parts.push(`${source.dir}/${name}:${stat.size}:${stat.mtimeMs}`);
      } catch {
        // Absent.
      }
    }
  }
  return parts.join('|');
}

/** Copie dans le projet les fichiers du thème par défaut qui n'y sont pas encore. Retourne les fichiers copiés. */
export function copyDefaultTheme(root: string, defaultDir: string): string[] {
  const copied: string[] = [];
  for (const name of THEME_FILES) {
    const target = path.join(root, PROJECT_THEME_DIR, name);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(defaultDir, name), target);
    copied.push(name);
  }
  const readme = path.join(defaultDir, 'README.md');
  const target = path.join(root, PROJECT_THEME_DIR, 'README.md');
  if (fs.existsSync(readme) && !fs.existsSync(target)) fs.copyFileSync(readme, target);
  return copied;
}
