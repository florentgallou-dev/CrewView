// Gyrophare du mur du fond : résume l'état de toute l'équipe en une couleur.
// Il tourne tant qu'un agent est occupé ou attend une réponse, et reste fixe en vert quand l'équipe est libre.

import type { AgentStatus } from '../types';
import { withAlpha } from './iso';
import { drawSprite } from './sprites';

export type BeaconLevel = 'question' | 'writing' | 'thinking' | 'reading' | 'free';

export const BEACON_COLORS: Record<BeaconLevel, string> = {
  question: '#2f7de1',
  writing: '#e5383b',
  thinking: '#f08a24',
  reading: '#f2c12e',
  free: '#2fb36a',
};

/** Libellés de la légende, dans l'ordre de priorité. */
export const BEACON_LABELS: Record<BeaconLevel, string> = {
  question: 'Attend ta réponse',
  writing: 'Écrit / exécute',
  thinking: 'Réfléchit',
  reading: 'Lit',
  free: 'Libre',
};

const LEVEL_OF: Record<AgentStatus, BeaconLevel> = {
  asking: 'question',
  writing: 'writing',
  running: 'writing',
  thinking: 'thinking',
  delegating: 'thinking',
  talking: 'thinking',
  reading: 'reading',
  idle: 'free',
  done: 'free',
};

/**
 * Priorité : une question pour toi d'abord, puis l'activité la plus lourde en cours.
 * La délégation passe après la lecture : un agent qui attend ses sous-agents laisse voir ce qu'ils font.
 */
const PRIORITY: AgentStatus[] = ['asking', 'writing', 'running', 'thinking', 'talking', 'reading', 'delegating', 'idle', 'done'];

export function beaconLevel(statuses: Iterable<AgentStatus>): BeaconLevel {
  let best = PRIORITY.length - 1;
  for (const status of statuses) best = Math.min(best, PRIORITY.indexOf(status));
  return LEVEL_OF[PRIORITY[best]];
}

/** Durée d'un tour du gyrophare, en secondes. */
export const TURN_S = 1.1;
/** Centre du dôme par rapport à l'ancre du SVG (milieu du bas du dôme). */
const DOME = { x: 0, y: -6 };

/** Dessine le gyrophare dans le repère à plat du mur (après onWall), ancre en (0,0). */
export function drawBeacon(ctx: CanvasRenderingContext2D, level: BeaconLevel, t: number): void {
  const color = BEACON_COLORS[level];
  if (level === 'free') {
    halo(ctx, color, 15, 0.32);
    drawSprite(ctx, 'decor/gyrophare.svg', { x: 0, y: 0 }, color);
    return;
  }
  const angle = (t / TURN_S) * Math.PI * 2;
  // Deux miroirs opposés : chaque faisceau balaie le mur, plus vif quand il passe face à nous.
  for (const phase of [0, Math.PI]) beam(ctx, color, angle + phase);
  const facing = Math.max(Math.cos(angle), Math.cos(angle + Math.PI));
  halo(ctx, color, 16 + 8 * facing, 0.25 + 0.3 * facing);
  drawSprite(ctx, 'decor/gyrophare.svg', { x: 0, y: 0 }, color);
  // Reflet de la lampe qui tourne derrière le verre.
  for (const phase of [0, Math.PI]) {
    const a = angle + phase;
    const front = Math.cos(a);
    if (front <= 0) continue;
    const x = DOME.x + Math.sin(a) * 5;
    const glare = ctx.createRadialGradient(x, DOME.y, 0, x, DOME.y, 5);
    glare.addColorStop(0, `rgba(255,255,255,${0.85 * front})`);
    glare.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glare;
    ctx.fillRect(x - 5, DOME.y - 5, 10, 10);
  }
}

function halo(ctx: CanvasRenderingContext2D, color: string, radius: number, alpha: number): void {
  const gradient = ctx.createRadialGradient(DOME.x, DOME.y, 2, DOME.x, DOME.y, radius);
  gradient.addColorStop(0, withAlpha(color, alpha));
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(DOME.x - radius, DOME.y - radius, radius * 2, radius * 2);
}

/** Faisceau projeté sur le mur : cône horizontal dont la longueur suit la rotation. */
function beam(ctx: CanvasRenderingContext2D, color: string, angle: number): void {
  const reach = Math.sin(angle) * 70;
  const strength = 0.12 + 0.28 * Math.max(0, Math.cos(angle));
  if (Math.abs(reach) < 4) return;
  const end = DOME.x + reach;
  const spread = 6 + Math.abs(reach) * 0.22;
  const gradient = ctx.createLinearGradient(DOME.x, 0, end, 0);
  gradient.addColorStop(0, withAlpha(color, strength));
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(DOME.x, DOME.y - 2);
  ctx.lineTo(end, DOME.y - spread);
  ctx.lineTo(end, DOME.y + spread);
  ctx.lineTo(DOME.x, DOME.y + 2);
  ctx.closePath();
  ctx.fill();
}


/** Légende du coin haut droit : une ligne par couleur, l'état en cours mis en évidence. */
export function createLegend(list: HTMLElement): (level: BeaconLevel) => void {
  const items = new Map<BeaconLevel, HTMLElement>();
  for (const level of Object.keys(BEACON_LABELS) as BeaconLevel[]) {
    const item = document.createElement('li');
    item.title = BEACON_LABELS[level];
    item.style.setProperty('--beacon', BEACON_COLORS[level]);
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = BEACON_LABELS[level];
    item.append(swatch, label);
    list.append(item);
    items.set(level, item);
  }
  list.style.setProperty('--turn', `${TURN_S}s`);
  let current: BeaconLevel | undefined;
  return (level) => {
    if (level === current) return;
    current = level;
    list.dataset.level = level;
    for (const [key, item] of items) item.classList.toggle('active', key === level);
  };
}
