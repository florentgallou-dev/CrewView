// Emplacements des transcripts de Claude Code.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function claudeHome(override?: string): string {
  return override?.trim() || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** Claude Code range les sessions d'un dossier sous projects/<chemin dont tout caractère non alphanumérique devient « - »>. */
export function projectSlug(root: string): string {
  return path.resolve(root).replace(/[^a-zA-Z0-9]/g, '-');
}

/** Dossier des transcripts du projet (il peut ne pas exister encore si aucune session n'a été lancée). */
export function projectTranscriptDir(root: string, home: string): string {
  const projects = path.join(home, 'projects');
  const slug = projectSlug(root);
  const direct = path.join(projects, slug);
  if (fs.existsSync(direct)) return direct;
  try {
    // Sous Windows, la casse de la lettre de lecteur peut différer (c--DEV vs C--DEV).
    const match = fs.readdirSync(projects).find((name) => name.toLowerCase() === slug.toLowerCase());
    if (match) return path.join(projects, match);
  } catch {
    // Pas encore de dossier projects : on surveillera le chemin attendu.
  }
  return direct;
}
