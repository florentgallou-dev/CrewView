// Décor : sol, murs, mobilier et accessoires des postes.

import type { AgentStatus, SceneAgent } from '../types';
import { box, ellipse, iso, onWall, poly, shade, shaded, TZ, WALL_UNIT, withAlpha } from './iso';

export const ROOM = { width: 14, depth: 11, height: 3 };
export const DOOR = { y: 9.4, width: 1.2 };

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: '#9aa0a6',
  thinking: '#8b6cf0',
  reading: '#3d8ee0',
  writing: '#19a979',
  running: '#e8a33b',
  delegating: '#e8743b',
  asking: '#d64550',
  talking: '#13a4b4',
  done: '#19a979',
};

const DESK_HEIGHT = 0.75;
const INK = '#16181b';

// ---- Sol et murs ---------------------------------------------------------------------

export function drawRoom(ctx: CanvasRenderingContext2D, projectName: string): void {
  const { width: W, depth: D, height: H } = ROOM;

  // Sol carrelé
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < D; y++) {
      poly(ctx, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], (x + y) % 2 ? '#eef0f2' : '#f3f4f6', '#e1e4e8');
    }
  }
  // Lumière zénithale
  const center = iso(W / 2, D / 2);
  const light = ctx.createRadialGradient(center.x, center.y, 10, center.x, center.y, 420);
  light.addColorStop(0, 'rgba(255,255,255,0.55)');
  light.addColorStop(1, 'rgba(255,255,255,0)');
  poly(ctx, [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]], 'transparent');
  ctx.fillStyle = light;
  ctx.fill();

  // Mur du fond (y = 0) et mur gauche (x = 0)
  poly(ctx, [[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]], '#f7f8f9');
  poly(ctx, [[0, 0, 0], [0, D, 0], [0, D, H], [0, 0, H]], '#e6e8eb');
  panelLines(ctx);
  // Plinthes et arêtes
  poly(ctx, [[0, 0, 0], [W, 0, 0], [W, 0, 0.12], [0, 0, 0.12]], '#d9dce0');
  poly(ctx, [[0, 0, 0], [0, D, 0], [0, D, 0.12], [0, 0, 0.12]], '#cfd3d8');
  poly(ctx, [[0, 0, H], [W, 0, H], [W, -0.15, H], [-0.15, -0.15, H]], '#d3d6da');
  poly(ctx, [[0, 0, H], [0, D, H], [-0.15, D, H], [-0.15, -0.15, H]], '#c8ccd1');

  drawDoor(ctx);
  drawSignage(ctx, projectName);
  drawPortrait(ctx, 6.4, 1.55);
  drawClock(ctx, 11.4, 2.25);
}

function panelLines(ctx: CanvasRenderingContext2D): void {
  const { width: W, depth: D, height: H } = ROOM;
  ctx.strokeStyle = 'rgba(0,0,0,0.055)';
  ctx.lineWidth = 1;
  const line = (a: [number, number, number], b: [number, number, number]) => {
    const p = iso(...a);
    const q = iso(...b);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  };
  for (let x = 1.4; x < W; x += 1.4) line([x, 0, 0.12], [x, 0, H]);
  for (let y = 1.1; y < D; y += 1.1) line([0, y, 0.12], [0, y, H]);
  for (let z = 1; z < H; z += 1) {
    line([0, 0, z], [W, 0, z]);
    line([0, 0, z], [0, D, z]);
  }
}

function drawDoor(ctx: CanvasRenderingContext2D): void {
  const { y, width } = DOOR;
  poly(ctx, [[0, y, 0], [0, y + width, 0], [0, y + width, 2.15], [0, y, 2.15]], '#c3c8ce');
  poly(ctx, [[0, y + 0.08, 0], [0, y + width - 0.08, 0], [0, y + width - 0.08, 2.07], [0, y + 0.08, 2.07]], '#8f969e');
  ctx.save();
  onWall(ctx, 'left', y + width + 0.05, 2.75);
  ctx.fillStyle = INK;
  ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('INTÉRIM', 0, 0);
  ctx.restore();
}

function drawSignage(ctx: CanvasRenderingContext2D, projectName: string): void {
  ctx.save();
  onWall(ctx, 'back', 0.6, 2.55);
  ctx.fillStyle = 'rgba(22,24,27,0.78)';
  ctx.font = '800 24px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('CREW', 0, 0);
  ctx.fillStyle = 'rgba(22,24,27,0.42)';
  ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(projectName.toUpperCase().slice(0, 28), 0, 20);
  ctx.restore();
}

/** Cadre « employé du mois » au-dessus du bureau principal. */
function drawPortrait(ctx: CanvasRenderingContext2D, u: number, z: number): void {
  ctx.save();
  onWall(ctx, 'back', u, z + 0.95);
  const w = 0.8 * WALL_UNIT;
  const h = 0.95 * TZ;
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e9e4d8';
  ctx.fillRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.36, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(w / 2 - 6.5, h * 0.36 + 5.5, 13, h * 0.5, [5, 5, 0, 0]);
  ctx.fill();
  ctx.restore();
}

function drawClock(ctx: CanvasRenderingContext2D, u: number, z: number): void {
  ctx.save();
  onWall(ctx, 'back', u, z);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#3a3f46';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const now = new Date();
  const hand = (angle: number, length: number, width: number) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
    ctx.stroke();
  };
  hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 4.5, 1.6);
  hand(now.getMinutes() * (Math.PI / 30), 6.8, 1.1);
  ctx.restore();
}

// ---- Mobilier décoratif ------------------------------------------------------------------

export interface Drawable {
  depth: number;
  draw(ctx: CanvasRenderingContext2D, t: number): void;
}

export function decorDrawables(): Drawable[] {
  return [
    { depth: 0.6 + 1.3, draw: (ctx) => box(ctx, 0.1, 0.9, 0, 0.6, 0.65, 1.35, shaded('#b9bec5', 'rgba(0,0,0,0.08)')) },
    { depth: 0.6 + 2.0, draw: (ctx) => box(ctx, 0.1, 1.6, 0, 0.6, 0.65, 1.35, shaded('#b9bec5', 'rgba(0,0,0,0.08)')) },
    { depth: 13.5 + 0.5, draw: (ctx, t) => drawWaterCooler(ctx, 13.2, 0.25, t) },
    { depth: 0.5 + 0.5, draw: (ctx) => drawPlant(ctx, 0.25, 0.25, 1.4) },
    { depth: 13.5 + 7.5, draw: (ctx) => drawPlant(ctx, 13.3, 7.3, 1.1) },
  ];
}

function drawWaterCooler(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  box(ctx, x, y, 0, 0.5, 0.5, 0.95, shaded('#eef0f2', 'rgba(0,0,0,0.1)'));
  const top = iso(x + 0.25, y + 0.25, 1.22);
  ctx.fillStyle = 'rgba(88,153,218,0.75)';
  ellipse(ctx, top.x, top.y, 9, 12);
  ctx.fill();
  const bubble = iso(x + 0.25, y + 0.25, 1.1 + ((t * 0.25) % 0.3));
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ellipse(ctx, bubble.x + 2, bubble.y, 1.4, 1.4);
  ctx.fill();
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  box(ctx, x, y, 0, 0.42, 0.42, 0.38, shaded('#d8d2c8'));
  const base = iso(x + 0.21, y + 0.21, 0.38);
  ctx.fillStyle = '#5f8f4e';
  for (const [dx, dy, r] of [[0, -14, 10], [-8, -8, 8], [8, -9, 8], [0, -24, 8], [-5, -20, 7], [6, -19, 7]]) {
    ellipse(ctx, base.x + dx * size, base.y + dy * size, r * size, r * size * 0.9);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ellipse(ctx, base.x - 3 * size, base.y - 20 * size, 5 * size, 4 * size);
  ctx.fill();
}

// ---- Postes de travail ---------------------------------------------------------------------

export function deskDepth(agent: SceneAgent): number {
  const { x, y, w, d } = agent.desk;
  return x + w / 2 + y + d / 2;
}

/** Ombre portée et zone d'activité au sol, dessinées avant tous les objets. */
export function drawDeskFloor(ctx: CanvasRenderingContext2D, agent: SceneAgent, selected: boolean): void {
  const { x, y, w, d } = agent.desk;
  poly(ctx, [[x - 0.25, y + 0.2, 0], [x + w - 0.25, y + 0.2, 0], [x + w - 0.1, y + d + 0.3, 0], [x - 0.1, y + d + 0.3, 0]], 'rgba(30,35,45,0.07)');
  const status = agent.runtime.status;
  if (!selected && status === 'idle') return;
  const color = selected ? agent.color : STATUS_COLORS[status];
  poly(ctx, [[x - 0.15, y - 0.6, 0], [x + w + 0.15, y - 0.6, 0], [x + w + 0.15, y + d + 0.15, 0], [x - 0.15, y + d + 0.15, 0]], withAlpha(color, selected ? 0.16 : 0.1));
  ctx.strokeStyle = withAlpha(color, selected ? 0.85 : 0.4);
  ctx.lineWidth = selected ? 2 : 1.25;
  ctx.stroke();
}

export function drawDesk(ctx: CanvasRenderingContext2D, agent: SceneAgent, t: number): void {
  const { x, y, w, d, kind } = agent.desk;
  const status = agent.runtime.status;

  if (kind === 'boss') {
    box(ctx, x, y, 0, w, d, DESK_HEIGHT, { top: '#b4724b', left: '#8d5434', right: '#74432a', edge: 'rgba(0,0,0,0.15)' });
    // Tiroirs
    for (const u of [0.15, w - 0.75]) poly(ctx, [[x + u, y + d, 0.15], [x + u + 0.6, y + d, 0.15], [x + u + 0.6, y + d, 0.6], [x + u, y + d, 0.6]], '#7f4b2f', 'rgba(0,0,0,0.2)');
  } else if (kind === 'shared') {
    box(ctx, x, y, 0, w, d, DESK_HEIGHT, { top: '#f2f4f6', left: '#4f7fb3', right: '#3f6893', edge: 'rgba(0,0,0,0.12)' });
  } else {
    box(ctx, x, y, 0, w, d, DESK_HEIGHT, { top: '#f6f6f4', left: '#d5d8dc', right: '#c3c7cc', edge: 'rgba(0,0,0,0.1)' });
    // Bandeau de couleur de l'agent
    poly(ctx, [[x, y + d, 0.08], [x + w, y + d, 0.08], [x + w, y + d, 0.2], [x, y + d, 0.2]], agent.color);
  }

  drawMonitor(ctx, x + 0.16, y + 0.1, status, t, kind === 'shared');
  drawAccessory(ctx, agent, t);

}

function drawMonitor(ctx: CanvasRenderingContext2D, x: number, y: number, status: AgentStatus, t: number, laptop: boolean): void {
  const z = DESK_HEIGHT;
  if (laptop) {
    box(ctx, x, y + 0.15, z, 0.42, 0.3, 0.03, shaded('#5b6068'));
    box(ctx, x, y + 0.12, z + 0.03, 0.42, 0.04, 0.26, shaded('#3a3f46'));
  } else {
    box(ctx, x + 0.2, y + 0.06, z, 0.08, 0.08, 0.14, shaded('#3a3f46'));
    box(ctx, x, y, z + 0.14, 0.5, 0.08, 0.36, { top: '#4a4f57', left: '#2b2f36', right: '#22252b' });
  }
  // Lueur de l'écran et voyant d'état
  const color = STATUS_COLORS[status];
  if (status !== 'idle') {
    const glow = iso(x + 0.25, y - 0.15, z + 0.35);
    const pulse = 0.18 + 0.08 * Math.sin(t * (status === 'running' ? 9 : 3));
    const gradient = ctx.createRadialGradient(glow.x, glow.y, 1, glow.x, glow.y, 26);
    gradient.addColorStop(0, withAlpha(color, pulse + 0.15));
    gradient.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = gradient;
    ellipse(ctx, glow.x, glow.y, 26, 20);
    ctx.fill();
  }
  const led = iso(x + (laptop ? 0.38 : 0.44), y + (laptop ? 0.16 : 0.08), z + (laptop ? 0.08 : 0.2));
  const blink = status === 'idle' || Math.sin(t * 6) > -0.6;
  ctx.fillStyle = blink ? color : shade(color, -0.4);
  ellipse(ctx, led.x, led.y, 1.8, 1.8);
  ctx.fill();
}

function drawAccessory(ctx: CanvasRenderingContext2D, agent: SceneAgent, t: number): void {
  const { x, y, w, d } = agent.desk;
  const ax = x + w - 0.38;
  const ay = y + d * 0.5;
  const z = DESK_HEIGHT;
  const p = iso(ax, ay, z);
  switch (agent.accessory) {
    case 'plant':
      box(ctx, ax - 0.08, ay - 0.08, z, 0.16, 0.16, 0.14, shaded('#c96f4a'));
      ctx.fillStyle = '#5f8f4e';
      for (const [dx, dy, r] of [[0, -10, 5], [-4, -7, 4], [4, -7, 4]]) {
        ellipse(ctx, p.x + dx, p.y + dy, r, r);
        ctx.fill();
      }
      break;
    case 'mug':
      ctx.fillStyle = agent.color;
      ctx.fillRect(p.x - 3.5, p.y - 8, 7, 8);
      ellipse(ctx, p.x, p.y - 8, 3.5, 1.5);
      ctx.fillStyle = shade(agent.color, -0.4);
      ctx.fill();
      break;
    case 'books':
      ['#5899da', '#e8743b', '#19a979'].forEach((c, i) => box(ctx, ax - 0.15, ay - 0.1, z + i * 0.06, 0.3, 0.2, 0.06, shaded(c)));
      break;
    case 'lamp':
      ctx.strokeStyle = '#3a3f46';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 2, p.y - 14);
      ctx.lineTo(p.x + 6, p.y - 19);
      ctx.stroke();
      ctx.fillStyle = agent.color;
      ctx.beginPath();
      ctx.moveTo(p.x + 2, p.y - 20);
      ctx.lineTo(p.x + 11, p.y - 22);
      ctx.lineTo(p.x + 10, p.y - 14);
      ctx.fill();
      break;
    case 'magnifier':
      ctx.strokeStyle = '#3a3f46';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 6, 4.5, 0, Math.PI * 2);
      ctx.moveTo(p.x + 3.2, p.y - 2.8);
      ctx.lineTo(p.x + 8, p.y + 1.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(160,200,235,0.5)';
      ctx.fill();
      break;
    case 'trophy':
      box(ctx, ax - 0.08, ay - 0.08, z, 0.16, 0.16, 0.12, shaded('#3a2a1c'));
      ctx.fillStyle = '#d4a20a';
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y - 14);
      ctx.lineTo(p.x + 5, p.y - 14);
      ctx.quadraticCurveTo(p.x + 4, p.y - 6, p.x, p.y - 5.5);
      ctx.quadraticCurveTo(p.x - 4, p.y - 6, p.x - 5, p.y - 14);
      ctx.fill();
      ctx.fillRect(p.x - 1, p.y - 6, 2, 3);
      break;
    case 'shield':
      ctx.fillStyle = agent.color;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y - 14);
      ctx.lineTo(p.x + 5, p.y - 14);
      ctx.lineTo(p.x + 5, p.y - 8);
      ctx.quadraticCurveTo(p.x, p.y - 2, p.x - 5, p.y - 8);
      ctx.fill();
      break;
    case 'server': {
      // Baie posée au sol à droite du bureau
      const sx = x + w + 0.12;
      box(ctx, sx, y, 0, 0.45, 0.6, 1.25, shaded('#2f343b', 'rgba(0,0,0,0.3)'));
      const running = agent.runtime.status === 'running';
      for (let i = 0; i < 5; i++) {
        const led = iso(sx + 0.45, y + 0.12 + (i % 2) * 0.3, 0.3 + i * 0.18);
        ctx.fillStyle = running && Math.sin(t * 12 + i * 1.7) > 0 ? '#3ddc84' : '#1c6b40';
        ellipse(ctx, led.x, led.y, 1.4, 1.4);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }
}

/** Étiquette au sol devant le poste. */
export function drawNameplate(ctx: CanvasRenderingContext2D, agent: SceneAgent, selected: boolean): void {
  const { x, y, w, d } = agent.desk;
  const p = iso(x + w / 2, y + d + 0.32);
  const label = agent.temp ? `${agent.name} · intérim` : agent.name;
  ctx.font = `${selected ? 700 : 600} 10.5px "Segoe UI", system-ui, sans-serif`;
  const width = ctx.measureText(label).width + 20;
  ctx.fillStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.86)';
  ctx.strokeStyle = selected ? agent.color : 'rgba(22,24,27,0.18)';
  ctx.lineWidth = selected ? 1.6 : 1;
  ctx.beginPath();
  ctx.roundRect(p.x - width / 2, p.y - 8, width, 16, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = agent.color;
  ellipse(ctx, p.x - width / 2 + 8, p.y, 3, 3);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, p.x - width / 2 + 14, p.y + 0.5);
  ctx.textBaseline = 'alphabetic';
}
