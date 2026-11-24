// Décor : sol, murs, mobilier et postes de travail. La salle prend les dimensions calculées par l'extension.
// Les formes viennent des images SVG du thème (sprites.ts) ; seules les animations sont dessinées ici.

import type { Accessory, AgentStatus, RoomLayout, SceneAgent } from '../types';
import { ellipse, iso, onWall, poly, TZ, WALL_UNIT, withAlpha } from './iso';
import { type BeaconLevel, drawBeacon } from './beacon';
import { drawSprite, drawSpriteIn } from './sprites';
import { STATUS_COLORS } from './status';

export const WALL_HEIGHT = 3;
const DESK_HEIGHT = 0.75;
const INK = '#16181b';

/** Porte de l'espace intérim, sur le mur gauche, à hauteur de la dernière rangée. */
export function doorOf(room: RoomLayout): { y: number; width: number } {
  return { y: Math.max(3, room.depth - 2.6), width: 1.2 };
}

// ---- Sol et murs ---------------------------------------------------------------------

export function drawRoom(
  ctx: CanvasRenderingContext2D,
  projectName: string,
  room: RoomLayout,
  bossX: number,
  beacon: BeaconLevel,
  t: number,
): void {
  const { width: W, depth: D } = room;
  const H = WALL_HEIGHT;

  // Sol : motif de 2 × 2 dalles répété, coupé aux limites de la salle.
  ctx.save();
  clipTo(ctx, [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]]);
  for (let x = 0; x < W; x += 2) for (let y = 0; y < D; y += 2) drawSprite(ctx, 'decor/sol.svg', iso(x, y));
  ctx.restore();
  // Lumière zénithale
  const center = iso(W / 2, D / 2);
  const light = ctx.createRadialGradient(center.x, center.y, 10, center.x, center.y, 30 * (W + D));
  light.addColorStop(0, 'rgba(255,255,255,0.55)');
  light.addColorStop(1, 'rgba(255,255,255,0)');
  poly(ctx, [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]], 'transparent');
  ctx.fillStyle = light;
  ctx.fill();

  // Mur du fond (y = 0) et mur gauche (x = 0) : panneaux dessinés à plat, répétés sur la longueur.
  ctx.save();
  clipTo(ctx, [[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]]);
  for (let u = 0; u < W; u += BACK_PANEL) onWallSprite(ctx, 'back', u, H, 'decor/mur-fond.svg');
  ctx.restore();
  ctx.save();
  clipTo(ctx, [[0, 0, 0], [0, D, 0], [0, D, H], [0, 0, H]]);
  // Sur le mur gauche, le dessin à plat va de l'avant vers le fond : chaque panneau part de son bord avant.
  for (let u = LEFT_PANEL; u - LEFT_PANEL < D; u += LEFT_PANEL) onWallSprite(ctx, 'left', u, H, 'decor/mur-gauche.svg');
  ctx.restore();
  // Arêtes du haut des murs
  poly(ctx, [[0, 0, H], [W, 0, H], [W, -0.15, H], [-0.15, -0.15, H]], '#d3d6da');
  poly(ctx, [[0, 0, H], [0, D, H], [-0.15, D, H], [-0.15, -0.15, H]], '#c8ccd1');

  const door = doorOf(room);
  onWallSprite(ctx, 'left', door.y + door.width, 2.15, 'decor/porte.svg');
  drawSignage(ctx, projectName);
  onWallSprite(ctx, 'back', bossX + 0.8, 2.5, 'decor/cadre.svg');
  // Gyrophare fixé dans l'angle du fond, dessiné de face ; sa lumière déborde sur les deux murs et au-delà.
  const corner = iso(0, 0, BEACON_Z);
  ctx.save();
  ctx.translate(corner.x, corner.y);
  drawBeacon(ctx, beacon, t);
  ctx.restore();
  drawClock(ctx, W - 2.6, 2.25);
}

const BACK_PANEL = 1.4;
const LEFT_PANEL = 1.1;

function clipTo(ctx: CanvasRenderingContext2D, points: [number, number, number][]): void {
  ctx.beginPath();
  points.forEach(([x, y, z], i) => {
    const p = iso(x, y, z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.clip();
}

/** Image dessinée à plat sur un mur, ancrée au point (u, z) de ce mur. */
function onWallSprite(ctx: CanvasRenderingContext2D, wall: 'back' | 'left', u: number, z: number, name: string): void {
  ctx.save();
  onWall(ctx, wall, u, z);
  drawSprite(ctx, name, { x: 0, y: 0 });
  ctx.restore();
}

/** Hauteur du gyrophare sur l'arête de l'angle du fond, et position de l'enseigne le long du mur (en tuiles). */
const BEACON_Z = 2.42;
const SIGN_U = 0.6;

function drawSignage(ctx: CanvasRenderingContext2D, projectName: string): void {
  ctx.save();
  onWall(ctx, 'back', SIGN_U, 2.55);
  drawSprite(ctx, 'decor/enseigne.svg', { x: 0, y: 0 });
  ctx.fillStyle = 'rgba(22,24,27,0.42)';
  ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(projectName.toUpperCase().slice(0, 28), 0, 20);
  ctx.restore();
}

function drawClock(ctx: CanvasRenderingContext2D, u: number, z: number): void {
  ctx.save();
  onWall(ctx, 'back', u, z);
  drawSprite(ctx, 'decor/horloge.svg', { x: 0, y: 0 });
  ctx.strokeStyle = '#3a3f46';
  ctx.lineCap = 'round';
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

export function decorDrawables(room: RoomLayout): Drawable[] {
  const { width: W, depth: D } = room;
  return [
    { depth: 0.6 + 1.3, draw: (ctx) => drawSprite(ctx, 'decor/armoire.svg', iso(0.1, 0.9)) },
    { depth: 0.6 + 2.0, draw: (ctx) => drawSprite(ctx, 'decor/armoire.svg', iso(0.1, 1.6)) },
    { depth: W - 0.5 + 0.5, draw: (ctx, t) => drawWaterCooler(ctx, W - 0.8, 0.25, t) },
    { depth: 0.5 + 0.5, draw: (ctx) => drawSprite(ctx, 'decor/plante.svg', iso(0.25, 0.25)) },
    { depth: W - 0.5 + D * 0.66, draw: (ctx) => drawSprite(ctx, 'decor/plante.svg', iso(W - 0.7, D * 0.66 - 0.2), undefined, 0.8) },
  ];
}

function drawWaterCooler(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  drawSprite(ctx, 'decor/fontaine.svg', iso(x, y));
  const bubble = iso(x + 0.25, y + 0.25, 1.1 + ((t * 0.25) % 0.3));
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ellipse(ctx, bubble.x + 2, bubble.y, 1.4, 1.4);
  ctx.fill();
}

// ---- Postes de travail ---------------------------------------------------------------------

export function deskDepth(agent: SceneAgent): number {
  const { x, y, w, d } = agent.desk;
  return x + w / 2 + y + d / 2;
}

/** Ombre portée et zone d'activité au sol (bureau + place de l'agent devant), dessinées avant tous les objets. */
export function drawDeskFloor(ctx: CanvasRenderingContext2D, agent: SceneAgent, selected: boolean): void {
  const { x, y, w, d } = agent.desk;
  poly(ctx, [[x - 0.25, y + 0.2, 0], [x + w - 0.25, y + 0.2, 0], [x + w - 0.1, y + d + 0.3, 0], [x - 0.1, y + d + 0.3, 0]], 'rgba(30,35,45,0.07)');
  const status = agent.runtime.status;
  if (!selected && status === 'idle') return;
  const color = selected ? agent.color : STATUS_COLORS[status];
  poly(ctx, [[x - 0.15, y - 0.15, 0], [x + w + 0.15, y - 0.15, 0], [x + w + 0.15, y + d + 0.75, 0], [x - 0.15, y + d + 0.75, 0]], withAlpha(color, selected ? 0.16 : 0.1));
  ctx.strokeStyle = withAlpha(color, selected ? 0.85 : 0.4);
  ctx.lineWidth = selected ? 2 : 1.25;
  ctx.stroke();
}

const DESK_SPRITES: Record<SceneAgent['desk']['kind'], string> = {
  desk: 'mobilier/bureau.svg',
  boss: 'mobilier/bureau-chef.svg',
  shared: 'mobilier/poste-partage.svg',
};

const SCREEN_SPRITES: Record<AgentStatus, string> = {
  idle: 'ecrans/veille.svg',
  thinking: 'ecrans/reflexion.svg',
  reading: 'ecrans/lecture.svg',
  writing: 'ecrans/ecriture.svg',
  running: 'ecrans/terminal.svg',
  talking: 'ecrans/discussion.svg',
  delegating: 'ecrans/delegation.svg',
  asking: 'ecrans/question.svg',
  done: 'ecrans/termine.svg',
};

export function drawDesk(ctx: CanvasRenderingContext2D, agent: SceneAgent, t: number): void {
  const { x, y, w, kind } = agent.desk;
  const status = agent.runtime.status;
  drawSprite(ctx, DESK_SPRITES[kind], iso(x, y), agent.color);

  // Écran sur la droite du bureau, tourné vers l'agent (et donc visible) ; accessoire à gauche.
  if (kind === 'shared') {
    drawSprite(ctx, 'mobilier/portable.svg', iso(x + w - 0.52, y + 0.12, DESK_HEIGHT));
    drawScreen(ctx, x + w - 0.49, y + 0.31, DESK_HEIGHT + 0.05, 0.38, 0.24, status, t, 'laptop');
  } else {
    drawSprite(ctx, 'mobilier/moniteur.svg', iso(x + w - 0.66, y + 0.12, DESK_HEIGHT));
    drawScreen(ctx, x + w - 0.63, y + 0.2, DESK_HEIGHT + 0.17, 0.46, 0.32, status, t, agent.id);
  }
  drawAccessory(ctx, agent, t);
}

/**
 * Contenu de l'écran, dessiné sur sa face avant (plan y = constante, tourné vers la salle) :
 * image du statut étirée sur la dalle, puis animation éventuelle par-dessus.
 * (x, y, z) : coin bas-gauche de la dalle ; w, h : dimensions en tuiles.
 */
function drawScreen(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, w: number, h: number, status: AgentStatus, t: number, seed: string): void {
  const origin = iso(x, y, z + h);
  const W = w * WALL_UNIT;
  const Hpx = h * TZ;
  const color = STATUS_COLORS[status];
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.transform(0.894, 0.447, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, W, Hpx);
  ctx.clip();
  drawSpriteIn(ctx, SCREEN_SPRITES[status], 0, 0, W, Hpx, color);

  const hash = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);
  const lineWidth = (i: number) => 0.3 + (((hash + i * 37) % 11) / 11) * 0.6;
  const lines = (fill: string, speed: number, step = 2.6) => {
    const offset = (t * speed) % step;
    ctx.fillStyle = fill;
    for (let i = -1; i * step < Hpx + step; i++) {
      const row = i + Math.floor((t * speed) / step);
      ctx.fillRect(1.5 + ((row * 3) % 3), i * step + 1.5 - offset, (W - 3) * lineWidth(row), 1.2);
    }
  };

  switch (status) {
    case 'reading':
      lines('#9aa3ad', 2);
      break;
    case 'writing': {
      // Lignes de code qui s'écrivent, puis recommencent.
      const visible = Math.floor((t * 2.5) % 6) + 1;
      for (let i = 0; i < visible; i++) {
        ctx.fillStyle = i % 3 === 0 ? '#7fb8f0' : i % 3 === 1 ? '#9fdc9a' : '#e8c27a';
        ctx.fillRect(1.5 + (i % 2) * 2.5, 1.5 + i * 2.4, (W - 4) * lineWidth(i) * (i === visible - 1 ? ((t * 2.5) % 1) : 1), 1.2);
      }
      break;
    }
    case 'running':
      lines('#3ddc84', 9, 2.2);
      break;
    case 'thinking':
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = withAlpha(color, 0.35 + 0.65 * Math.max(0, Math.sin(t * 4 - i * 0.8)));
        ellipse(ctx, W / 2 - 4 + i * 4, Hpx / 2, 1.3, 1.3);
        ctx.fill();
      }
      break;
    case 'talking':
      lines('#13a4b4', 1.5, 3);
      break;
    case 'idle':
      // Veille : un point qui se promène lentement.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ellipse(ctx, (W / 2) + Math.sin(t * 0.4 + hash) * (W / 3), Hpx / 2 + Math.cos(t * 0.3 + hash) * (Hpx / 4), 0.9, 0.9);
      ctx.fill();
      break;
    default:
      // Délégation, question, terminé : l'image suffit.
      break;
  }
  ctx.restore();

  // Lueur de l'écran
  if (status !== 'idle') {
    const glow = iso(x + w / 2, y + 0.3, z + h / 2);
    const pulse = 0.12 + 0.06 * Math.sin(t * (status === 'running' ? 9 : 3));
    const gradient = ctx.createRadialGradient(glow.x, glow.y, 1, glow.x, glow.y, 24);
    gradient.addColorStop(0, withAlpha(color, pulse + 0.1));
    gradient.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = gradient;
    ellipse(ctx, glow.x, glow.y, 24, 18);
    ctx.fill();
  }
}

function drawAccessory(ctx: CanvasRenderingContext2D, agent: SceneAgent, t: number): void {
  const { x, y, w, d } = agent.desk;
  if (agent.accessory === 'none') return;
  if (agent.accessory === 'server') {
    // Baie posée au sol, contre le côté droit du bureau
    const sx = x + w + 0.12;
    drawSprite(ctx, 'accessoires/serveur.svg', iso(sx, y), agent.color);
    const running = agent.runtime.status === 'running';
    for (let i = 0; i < 5; i++) {
      const led = iso(sx + 0.45, y + 0.12 + (i % 2) * 0.3, 0.3 + i * 0.18);
      ctx.fillStyle = running && Math.sin(t * 12 + i * 1.7) > 0 ? '#3ddc84' : '#1c6b40';
      ellipse(ctx, led.x, led.y, 1.4, 1.4);
      ctx.fill();
    }
    return;
  }
  drawSprite(ctx, ACCESSORY_SPRITES[agent.accessory], iso(x + 0.36, y + d * 0.45, DESK_HEIGHT), agent.color);
}

const ACCESSORY_SPRITES: Record<Exclude<Accessory, 'none' | 'server'>, string> = {
  plant: 'accessoires/plante.svg',
  lamp: 'accessoires/lampe.svg',
  mug: 'accessoires/tasse.svg',
  books: 'accessoires/livres.svg',
  magnifier: 'accessoires/loupe.svg',
  trophy: 'accessoires/trophee.svg',
  shield: 'accessoires/bouclier.svg',
};

/** Étiquette au sol, devant l'agent. */
export function drawNameplate(ctx: CanvasRenderingContext2D, agent: SceneAgent, selected: boolean): void {
  const { x, y, w, d } = agent.desk;
  const p = iso(x + w / 2, y + d + 1.05);
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
