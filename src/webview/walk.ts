// Déplacements dans l'open-space : livraison de dossiers (délégations) et arrivée des intérimaires.

import type { Desk } from '../types';

export type Vec2 = [number, number];

const SPEED = 2.6; // tuiles par seconde
const PAUSE_S = 1.1;
/** Couloirs verticaux entre les colonnes de bureaux. */
const AISLES_X = [0.7, 3.8, 7.0, 10.2, 13.4];

export interface Stop {
  to: string;
  target: Vec2;
}

export interface Walker {
  pos: Vec2;
  path: Vec2[];
  stops: Stop[];
  phase: 'toStop' | 'pause' | 'home';
  pauseLeft: number;
  carrying: boolean;
  facing: 1 | -1;
  stride: number;
}

/** Point où l'on se tient pour remettre un dossier : devant le bureau. */
export function visitorSpot(desk: Desk): Vec2 {
  return [desk.x + desk.w * 0.5, desk.y + desk.d + 0.42];
}

export function startDelivery(from: Vec2, stop: Stop, desks: Desk[]): Walker {
  return { pos: [...from], path: route(from, stop.target, desks), stops: [stop], phase: 'toStop', pauseLeft: 0, carrying: true, facing: 1, stride: 0 };
}

export function startArrival(from: Vec2, home: Vec2, desks: Desk[]): Walker {
  return { pos: [...from], path: route(from, home, desks), stops: [], phase: 'home', pauseLeft: 0, carrying: false, facing: 1, stride: 0 };
}

export function addStop(walker: Walker, stop: Stop, desks: Desk[]): void {
  if (walker.phase === 'home') {
    walker.stops = [stop];
    walker.phase = 'toStop';
    walker.carrying = true;
    walker.path = route(walker.pos, stop.target, desks);
  } else {
    walker.stops.push(stop);
  }
}

/**
 * Fait avancer le marcheur. Retourne 'arrived:<id>' quand un dossier est remis,
 * 'done' quand il est rentré à son poste, sinon undefined.
 */
export function stepWalker(walker: Walker, dt: number, home: Vec2, desks: Desk[]): string | undefined {
  if (walker.phase === 'pause') {
    walker.pauseLeft -= dt;
    if (walker.pauseLeft > 0) return undefined;
    walker.stops.shift();
    const next = walker.stops[0];
    walker.phase = next ? 'toStop' : 'home';
    walker.carrying = Boolean(next);
    walker.path = route(walker.pos, next ? next.target : home, desks);
    return undefined;
  }

  let budget = SPEED * dt;
  while (budget > 0 && walker.path.length) {
    const [tx, ty] = walker.path[0];
    const dx = tx - walker.pos[0];
    const dy = ty - walker.pos[1];
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) walker.facing = dx - dy >= 0 ? 1 : -1; // sens à l'écran
    if (dist <= budget) {
      walker.pos = [tx, ty];
      walker.path.shift();
      budget -= dist;
    } else {
      walker.pos = [walker.pos[0] + (dx / dist) * budget, walker.pos[1] + (dy / dist) * budget];
      budget = 0;
    }
  }
  walker.stride += dt * 11;
  if (walker.path.length) return undefined;

  if (walker.phase === 'toStop') {
    walker.phase = 'pause';
    walker.pauseLeft = PAUSE_S;
    walker.carrying = false;
    return `arrived:${walker.stops[0]?.to ?? ''}`;
  }
  return 'done';
}

/** Trajet en L par un couloir vertical libre, évitant les bureaux. */
export function route(from: Vec2, to: Vec2, desks: Desk[]): Vec2[] {
  const candidates = [...AISLES_X].sort((a, b) => cost(a, from, to) - cost(b, from, to));
  const aisle = candidates.find((x) => isClear(from, to, x, desks)) ?? candidates[0];
  const path: Vec2[] = [[aisle, from[1]], [aisle, to[1]], to];
  return path.filter((p, i) => {
    const prev = i === 0 ? from : path[i - 1];
    return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01;
  });
}

function cost(aisle: number, from: Vec2, to: Vec2): number {
  return Math.abs(from[0] - aisle) + Math.abs(to[0] - aisle);
}

function isClear(from: Vec2, to: Vec2, aisle: number, desks: Desk[]): boolean {
  const segments: [Vec2, Vec2][] = [
    [from, [aisle, from[1]]],
    [[aisle, from[1]], [aisle, to[1]]],
    [[aisle, to[1]], to],
  ];
  return segments.every(([a, b]) => desks.every((desk) => !crosses(a, b, desk)));
}

/** Segment horizontal ou vertical traversant le rectangle (légèrement agrandi) d'un bureau. */
function crosses(a: Vec2, b: Vec2, desk: Desk): boolean {
  const m = 0.12;
  const x0 = desk.x - m;
  const x1 = desk.x + desk.w + m;
  const y0 = desk.y - m;
  const y1 = desk.y + desk.d + m;
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  return maxX > x0 && minX < x1 && maxY > y0 && minY < y1;
}
