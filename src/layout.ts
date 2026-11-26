// Placement des agents dans l'open-space et apparence par défaut.
// La salle s'agrandit avec le nombre d'agents : grille de bureaux séparés par des couloirs,
// grand bureau de l'agent principal au fond, puis l'espace des agents globaux (configuration de
// Claude Code commune à tous les projets), enfin la table partagée des intérimaires.

import type { AgentDefinition } from './discovery';
import { normalizeId } from './discovery';
import type { AgentLookConfig, CrewConfig } from './config';
import type { Accessory, Desk, GlobalOrigin, RoomLayout } from './types';

export const PALETTE = ['#e8743b', '#19a979', '#5899da', '#bf399e', '#d4a20a', '#13a4b4', '#945ecf', '#d64550', '#6c8893', '#7fa035'];

export const MAIN_ID = 'main';

const DESK_W = 1.6;
const DESK_D = 0.8;
const BOSS = { w: 2.4, d: 1.0, y: 0.9 };
const GRID = { x0: 1.4, y0: 3.8, colStep: 3.2, rowStep: 2.8 };
const SHARED = { seat: 1.2, seats: 4, d: 0.8 };
/** L'espace des agents globaux commence un peu avant leurs bureaux. */
const GLOBAL_ZONE_MARGIN = 0.6;
/** Marge libre autour de la grille (bords de salle, devant la dernière rangée). */
const MARGIN = { side: 1.4, front: 1.9 };

export interface DeskSlot {
  label: string;
  x: number;
  y: number;
}

export interface OfficeLayout {
  agents: PlacedAgent[];
  room: RoomLayout;
  /** Postes de la grille, proposés dans l'écran de paramètres. */
  slots: DeskSlot[];
  /** Coin arrière-gauche de la table partagée des intérimaires. */
  shared: { x: number; y: number };
}

export interface PlacedAgent {
  id: string;
  name: string;
  description: string;
  source?: string;
  color: string;
  accessory: Accessory;
  desk: Desk;
  spot: [number, number];
  isMain: boolean;
  temp: boolean;
  global?: GlobalOrigin;
}

/** Point où l'agent se tient : devant son bureau, face à son écran. */
export function standingSpot(desk: Desk): [number, number] {
  return [desk.x + desk.w * 0.62, desk.y + desk.d + 0.35];
}

export function guessAccessory(text: string): Accessory {
  const t = normalizeId(text);
  if (/orchestr|chef|lead|manager|coordin/.test(t)) return 'trophy';
  if (/revue|review|qualit|audit|secur|a11y/.test(t)) return 'magnifier';
  if (/back|api|laravel|server|serveur|data|db|infra|devops/.test(t)) return 'server';
  if (/explor|analy|research|recherche|doc/.test(t)) return 'books';
  if (/front|ui|design|builder|css|vue|nuxt/.test(t)) return 'plant';
  if (/test|qa/.test(t)) return 'shield';
  return 'mug';
}

/** Colonnes de bureaux : 4 jusqu'à 8 agents, 5 jusqu'à 15, 6 au-delà. */
function columnsFor(count: number): number {
  return count <= 8 ? 4 : count <= 15 ? 5 : 6;
}

/** Grille de postes pour `count` agents spécialisés (au moins deux rangées). */
export function gridSlots(count: number): DeskSlot[] {
  const cols = columnsFor(count);
  const rows = Math.max(2, Math.ceil(count / cols));
  const slots: DeskSlot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      slots.push({ label: `Rangée ${row + 1} – poste ${col + 1}`, x: GRID.x0 + col * GRID.colStep, y: GRID.y0 + row * GRID.rowStep });
    }
  }
  return slots;
}

/**
 * Place l'agent principal au grand bureau, les agents du projet sur la grille, les agents globaux
 * sur les rangées suivantes, et calcule la salle (dimensions, couloirs, espaces, table des intérimaires).
 */
export function placeAgents(definitions: AgentDefinition[], config: CrewConfig, globals: AgentDefinition[] = []): OfficeLayout {
  const lookOf = (id: string) => lookFor(config, id);
  const visible = definitions.filter((d) => !lookOf(d.id).hidden);
  const visibleGlobals = globals.filter((d) => !lookOf(d.id).hidden);

  const orchestratorId = config.orchestrator ? normalizeId(config.orchestrator) : visible.find((d) => d.isOrchestrator)?.id;
  const orchestrator = visible.find((d) => d.id === orchestratorId);
  const specialists = visible.filter((d) => d !== orchestrator);

  const cols = columnsFor(specialists.length);
  const slots = gridSlots(specialists.length);
  const rows = slots.length / cols;
  const gridWidth = GRID.x0 + (cols - 1) * GRID.colStep + DESK_W + MARGIN.side;

  const agents: PlacedAgent[] = [];
  const mainLook = lookOf(orchestrator?.id ?? MAIN_ID);
  agents.push({
    id: orchestrator?.id ?? MAIN_ID,
    name: mainLook.label ?? orchestrator?.name ?? 'Claude',
    description: orchestrator?.description ?? 'Session principale de Claude Code.',
    source: orchestrator?.source,
    color: mainLook.color ?? '#1f2328',
    accessory: mainLook.accessory ?? 'trophy',
    desk: withPosition({ x: gridWidth / 2 - BOSS.w / 2, y: BOSS.y, w: BOSS.w, d: BOSS.d, kind: 'boss' }, mainLook.desk),
    spot: [0, 0],
    isMain: true,
    temp: false,
  });

  specialists.forEach((definition, index) => {
    const look = lookOf(definition.id);
    const slot = slots[index];
    agents.push({
      id: definition.id,
      name: look.label ?? definition.name,
      description: definition.description,
      source: definition.source,
      color: look.color ?? PALETTE[index % PALETTE.length],
      accessory: look.accessory ?? guessAccessory(`${definition.name} ${definition.description}`),
      desk: withPosition({ x: slot.x, y: slot.y, w: DESK_W, d: DESK_D, kind: 'desk' }, look.desk),
      spot: [0, 0],
      isMain: false,
      temp: false,
    });
  });

  // Espace des agents globaux : rangées de la même grille, après celles du projet.
  const globalY = GRID.y0 + rows * GRID.rowStep;
  const globalRows = Math.ceil(visibleGlobals.length / cols);
  visibleGlobals.forEach((definition, index) => {
    const look = lookOf(definition.id);
    const x = GRID.x0 + (index % cols) * GRID.colStep;
    const y = globalY + Math.floor(index / cols) * GRID.rowStep;
    agents.push({
      id: definition.id,
      name: look.label ?? definition.name,
      description: definition.description,
      source: definition.source,
      color: look.color ?? PALETTE[(specialists.length + index) % PALETTE.length],
      accessory: look.accessory ?? guessAccessory(`${definition.name} ${definition.description}`),
      desk: withPosition({ x, y, w: DESK_W, d: DESK_D, kind: 'desk' }, look.desk),
      spot: [0, 0],
      isMain: false,
      temp: false,
      global: definition.global,
    });
  });
  for (const agent of agents) agent.spot = standingSpot(agent.desk);

  // Les postes personnalisés (configuration) peuvent sortir de la grille : la salle s'adapte.
  const sharedY = globalY + globalRows * GRID.rowStep;
  const width = Math.max(gridWidth, ...agents.map((a) => a.desk.x + a.desk.w + MARGIN.side));
  const depth = Math.max(sharedY + SHARED.d + MARGIN.front, ...agents.map((a) => a.desk.y + a.desk.d + MARGIN.front));
  const aisles = [GRID.x0 / 2];
  for (let col = 0; col < cols - 1; col++) aisles.push(GRID.x0 + col * GRID.colStep + DESK_W + (GRID.colStep - DESK_W) / 2);
  aisles.push(width - 0.7);

  return {
    agents,
    room: {
      width: round(width),
      depth: round(depth),
      aisles: aisles.map(round),
      ...(globalRows > 0 && { globalZone: { y: round(globalY - GLOBAL_ZONE_MARGIN), depth: round(globalRows * GRID.rowStep) } }),
    },
    slots,
    shared: { x: round(width - 1.0 - SHARED.seats * SHARED.seat), y: round(sharedY) },
  };
}

/** Place sur la table partagée pour le n-ième intérimaire (au-delà de 4, les places sont partagées). */
export function placeTemp(id: string, name: string, slot: number, shared: OfficeLayout['shared']): PlacedAgent {
  const desk: Desk = {
    x: shared.x + (slot % SHARED.seats) * SHARED.seat,
    y: shared.y,
    w: SHARED.seat,
    d: SHARED.d,
    kind: 'shared',
  };
  return {
    id,
    name,
    description: `Agent intégré de Claude Code (« ${name} »), non défini dans le projet.`,
    color: '#8a8f98',
    accessory: 'none',
    desk,
    spot: standingSpot(desk),
    isMain: false,
    temp: true,
  };
}

/** Apparence configurée d'un agent : clé exacte, ou clé dont la forme normalisée correspond. */
export function lookFor(config: CrewConfig, id: string): AgentLookConfig {
  const looks = config.agents ?? {};
  return looks[id] ?? Object.entries(looks).find(([key]) => normalizeId(key) === id)?.[1] ?? {};
}

/** Applique la configuration (nom, couleur) à un intérimaire ; undefined s'il est masqué. */
export function applyTempLook(temp: PlacedAgent, config: CrewConfig): PlacedAgent | undefined {
  const look = lookFor(config, temp.id);
  if (look.hidden) return undefined;
  return { ...temp, name: look.label || temp.name, color: look.color || temp.color };
}

function withPosition(desk: Desk, position?: [number, number]): Desk {
  if (!Array.isArray(position) || position.length !== 2) return desk;
  return { ...desk, x: Number(position[0]) || desk.x, y: Number(position[1]) || desk.y };
}

const round = (n: number) => Math.round(n * 100) / 100;
