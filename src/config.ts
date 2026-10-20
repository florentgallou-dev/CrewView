// Configuration visuelle d'un projet, versionnée dans .crew-view/config.json.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Accessory } from './types';

export const CONFIG_FILE = '.crew-view/config.json';

export interface AgentLookConfig {
  /** Nom affiché (par défaut : le `name` de la définition). */
  label?: string;
  /** Couleur d'accent CSS. */
  color?: string;
  accessory?: Accessory;
  /** Coin arrière-gauche du bureau, en tuiles (salle de 14 × 11). */
  desk?: [number, number];
  hidden?: boolean;
}

export interface CrewConfig {
  /** Dossiers d'agents supplémentaires, relatifs à la racine du projet. */
  agentsDirs?: string[];
  /** Identifiant (ou nom) de l'agent incarné par la session principale de Claude Code. */
  orchestrator?: string;
  agents?: Record<string, AgentLookConfig>;
}

export interface LoadedConfig {
  config: CrewConfig;
  error?: string;
}

export function loadConfig(root: string): LoadedConfig {
  const file = path.join(root, CONFIG_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { config: {} };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { config: {}, error: `${CONFIG_FILE} doit contenir un objet JSON.` };
    return { config: parsed as CrewConfig };
  } catch (error) {
    return { config: {}, error: `${CONFIG_FILE} invalide : ${(error as Error).message}` };
  }
}
