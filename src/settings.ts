// Données de l'écran de paramètres et écriture des modifications dans .crew-view/config.json.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_FILE, type AgentLookConfig, type CrewConfig } from './config';
import { normalizeId } from './discovery';
import type { CrewHub } from './hub';
import { DESK_SLOTS, lookFor } from './layout';
import type { Accessory, AgentPatch, Desk, ProjectPatch, SettingsAgent, SettingsData } from './types';

export const ACCESSORIES: Accessory[] = ['none', 'plant', 'lamp', 'mug', 'books', 'server', 'magnifier', 'trophy', 'shield'];
const TEMP_PREFIX = 'interim-';

export function buildSettings(hub: CrewHub, general: { port: number; claudeConfigDir: string }): SettingsData {
  const state = hub.snapshot();
  const config = hub.config;
  const definitions = hub.definitions;
  const nameOf = (id: string) => definitions.find((d) => d.id === id)?.name;
  const agents: SettingsAgent[] = [];

  // Ordre : agent principal, agents du projet (y compris masqués), intérimaires.
  const main = state.agents.find((a) => a.isMain);
  if (main) {
    const look = lookFor(config, main.id);
    agents.push({ id: main.id, name: main.name, defaultName: nameOf(main.id) ?? 'Claude', label: look.label, color: main.color, accessory: main.accessory, hidden: false, isMain: true, temp: false, slot: -1 });
  }
  for (const definition of definitions) {
    if (definition.id === main?.id) continue;
    const look = lookFor(config, definition.id);
    const placed = state.agents.find((a) => a.id === definition.id);
    const desk = placed ? ([placed.desk.x, placed.desk.y] as [number, number]) : look.desk;
    agents.push({
      id: definition.id,
      name: placed?.name ?? look.label ?? definition.name,
      defaultName: definition.name,
      label: look.label,
      color: placed?.color ?? look.color ?? '#9aa0a6',
      accessory: placed?.accessory ?? look.accessory ?? 'none',
      hidden: Boolean(look.hidden),
      isMain: false,
      temp: false,
      slot: desk ? slotIndex(desk[0], desk[1]) : -1,
      desk,
    });
  }
  const temps = state.agents.filter((a) => a.temp);
  for (const temp of temps) {
    const look = lookFor(config, temp.id);
    agents.push({ id: temp.id, name: temp.name, defaultName: temp.id.slice(TEMP_PREFIX.length), label: look.label, color: temp.color, accessory: 'none', hidden: false, isMain: false, temp: true, slot: -1 });
  }
  // Intérimaires masqués : absents de la scène, mais présents dans la configuration.
  for (const [key, look] of Object.entries(config.agents ?? {})) {
    if (!key.startsWith(TEMP_PREFIX) || !look.hidden || temps.some((t) => t.id === key)) continue;
    agents.push({ id: key, name: look.label ?? key.slice(TEMP_PREFIX.length), defaultName: key.slice(TEMP_PREFIX.length), label: look.label, color: look.color ?? '#8a8f98', accessory: 'none', hidden: true, isMain: false, temp: true, slot: -1 });
  }

  return {
    project: state.project,
    configExists: fs.existsSync(path.join(hub.root, CONFIG_FILE)),
    configError: hub.configError,
    orchestrator: config.orchestrator,
    agentsDirs: config.agentsDirs ?? [],
    definitions: definitions.map((d) => ({ id: d.id, name: d.name })),
    agents,
    slots: DESK_SLOTS,
    accessories: ACCESSORIES,
    port: general.port,
    claudeConfigDir: general.claudeConfigDir,
  };
}

export function applyAgentPatch(hub: CrewHub, id: string, patch: AgentPatch): void {
  const state = hub.snapshot();
  updateConfigFile(hub.root, (config) => {
    const look = lookEntry(config, id);
    if (patch.label !== undefined) {
      if (patch.label.trim()) look.label = patch.label.trim();
      else delete look.label;
    }
    if (patch.color) look.color = patch.color;
    if (patch.accessory) look.accessory = patch.accessory;
    if (patch.hidden !== undefined) {
      if (patch.hidden) look.hidden = true;
      else delete look.hidden;
    }
    const slot = patch.slot !== undefined ? DESK_SLOTS[patch.slot] : undefined;
    if (slot) {
      // Poste occupé : les deux agents échangent leur place.
      const me = state.agents.find((a) => a.id === id);
      const occupant = state.agents.find((a) => a.id !== id && !a.isMain && !a.temp && isAt(a.desk, slot.x, slot.y));
      if (occupant && me) lookEntry(config, occupant.id).desk = [me.desk.x, me.desk.y];
      look.desk = [slot.x, slot.y];
    }
    pruneLooks(config);
  });
  hub.reload();
}

export function applyProjectPatch(hub: CrewHub, patch: ProjectPatch): void {
  updateConfigFile(hub.root, (config) => {
    if (patch.orchestrator !== undefined) {
      if (patch.orchestrator) config.orchestrator = patch.orchestrator;
      else delete config.orchestrator;
    }
    if (patch.agentsDirs !== undefined) {
      const dirs = patch.agentsDirs.map((d) => d.trim()).filter(Boolean);
      if (dirs.length) config.agentsDirs = dirs;
      else delete config.agentsDirs;
    }
  });
  hub.reload();
}

/** Lit, modifie et réécrit la configuration en conservant les clés inconnues. Refuse d'écraser un JSON invalide. */
export function updateConfigFile(root: string, mutate: (config: CrewConfig) => void): void {
  const file = path.join(root, CONFIG_FILE);
  let config: CrewConfig = {};
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8')) as CrewConfig;
    } catch (error) {
      throw new Error(`${CONFIG_FILE} est invalide, corrigez-le avant de modifier les paramètres (${(error as Error).message}).`);
    }
  }
  mutate(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** Entrée de configuration d'un agent, en réutilisant une clé existante écrite sous une autre forme (« Revue Qualité »). */
function lookEntry(config: CrewConfig, id: string): AgentLookConfig {
  config.agents ??= {};
  const key = id in config.agents ? id : Object.keys(config.agents).find((k) => normalizeId(k) === id) ?? id;
  return (config.agents[key] ??= {});
}

function pruneLooks(config: CrewConfig): void {
  for (const [key, look] of Object.entries(config.agents ?? {})) {
    if (Object.keys(look).length === 0) delete config.agents![key];
  }
}

function slotIndex(x: number, y: number): number {
  return DESK_SLOTS.findIndex((s) => Math.abs(s.x - x) < 0.01 && Math.abs(s.y - y) < 0.01);
}

function isAt(desk: Desk, x: number, y: number): boolean {
  return Math.abs(desk.x - x) < 0.01 && Math.abs(desk.y - y) < 0.01;
}
