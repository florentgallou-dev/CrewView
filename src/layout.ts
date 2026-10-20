// Placement des agents dans l'open-space et apparence par défaut.

import type { AgentDefinition } from './discovery';
import { normalizeId } from './discovery';
import type { AgentLookConfig, CrewConfig } from './config';
import type { Accessory, Desk } from './types';

export const ROOM = { width: 14, depth: 11 };

export const PALETTE = ['#e8743b', '#19a979', '#5899da', '#bf399e', '#d4a20a', '#13a4b4', '#945ecf', '#d64550', '#6c8893', '#7fa035'];

export const MAIN_ID = 'main';

const BOSS_DESK: Desk = { x: 5.6, y: 1.0, w: 2.4, d: 1.0, kind: 'boss' };
const DESK_W = 1.6;
const DESK_D = 0.8;
export interface DeskSlot {
  label: string;
  x: number;
  y: number;
}

// 10 postes : deux rangées de quatre, puis deux bureaux devant à gauche (la droite est l'espace intérim).
export const DESK_SLOTS: DeskSlot[] = [
  ...[3.8, 6.6].flatMap((y, row) => [1.4, 4.6, 7.8, 11.0].map((x, i) => ({ label: `Rangée ${row + 1} – poste ${i + 1}`, x, y }))),
  { label: 'Avant – poste 1', x: 1.4, y: 9.4 },
  { label: 'Avant – poste 2', x: 4.6, y: 9.4 },
];
const SHARED_TABLE = { x: 8.6, y: 9.4, d: 0.8, seat: 1.2, seats: 4 };

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
}

/** Point où l'agent se tient : derrière son bureau, face à la salle. */
export function standingSpot(desk: Desk): [number, number] {
  return [desk.x + desk.w * 0.62, desk.y - 0.32];
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

/**
 * Place l'agent principal au grand bureau, les agents définis sur les rangées
 * de bureaux, et laisse la table partagée aux intérimaires (placés à la volée).
 */
export function placeAgents(definitions: AgentDefinition[], config: CrewConfig): PlacedAgent[] {
  const lookOf = (id: string) => lookFor(config, id);
  const visible = definitions.filter((d) => !lookOf(d.id).hidden);

  const orchestratorId = config.orchestrator ? normalizeId(config.orchestrator) : visible.find((d) => d.isOrchestrator)?.id;
  const orchestrator = visible.find((d) => d.id === orchestratorId);
  const specialists = visible.filter((d) => d !== orchestrator);

  const placed: PlacedAgent[] = [];
  const mainLook = lookOf(orchestrator?.id ?? MAIN_ID);
  placed.push({
    id: orchestrator?.id ?? MAIN_ID,
    name: mainLook.label ?? orchestrator?.name ?? 'Claude',
    description: orchestrator?.description ?? 'Session principale de Claude Code.',
    source: orchestrator?.source,
    color: mainLook.color ?? '#1f2328',
    accessory: mainLook.accessory ?? 'trophy',
    desk: withPosition(BOSS_DESK, mainLook.desk),
    spot: [0, 0],
    isMain: true,
    temp: false,
  });

  specialists.forEach((definition, index) => {
    const look = lookOf(definition.id);
    const { x: column, y: row } = DESK_SLOTS[index % DESK_SLOTS.length];
    placed.push({
      id: definition.id,
      name: look.label ?? definition.name,
      description: definition.description,
      source: definition.source,
      color: look.color ?? PALETTE[index % PALETTE.length],
      accessory: look.accessory ?? guessAccessory(`${definition.name} ${definition.description}`),
      desk: withPosition({ x: column, y: row, w: DESK_W, d: DESK_D, kind: 'desk' }, look.desk),
      spot: [0, 0],
      isMain: false,
      temp: false,
    });
  });

  for (const agent of placed) agent.spot = standingSpot(agent.desk);
  return placed;
}

/** Place sur la table partagée pour le n-ième intérimaire (au-delà de 4, les places sont partagées). */
export function placeTemp(id: string, name: string, slot: number): PlacedAgent {
  const desk: Desk = {
    x: SHARED_TABLE.x + (slot % SHARED_TABLE.seats) * SHARED_TABLE.seat,
    y: SHARED_TABLE.y,
    w: SHARED_TABLE.seat,
    d: SHARED_TABLE.d,
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
