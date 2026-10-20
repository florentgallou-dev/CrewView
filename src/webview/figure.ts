// Silhouettes pictogrammes (noir plein) et leurs postures selon l'activité.

import type { AgentStatus } from '../types';
import { ellipse, type Point, withAlpha } from './iso';

const INK = '#16181b';
const HEAD_R = 7.2;
const BODY_H = 40;

export type Arms = 'none' | 'type' | 'chin' | 'raise' | 'stretch' | 'carry' | 'gesture';

export interface Pose {
  bob: number;
  headDx: number;
  headDy: number;
  arms: Arms;
  /** Phase de marche, ou -1 à l'arrêt. */
  walk: number;
  facing: 1 | -1;
}

/** Posture d'un agent à son poste selon son statut. `since` = secondes depuis le changement de statut. */
export function poseFor(status: AgentStatus, t: number, since: number, seed: number): Pose {
  const pose: Pose = { bob: 0, headDx: 0, headDy: 0, arms: 'none', walk: -1, facing: 1 };
  switch (status) {
    case 'idle':
      pose.bob = Math.sin(t * 1.4 + seed) * 0.6;
      pose.headDx = Math.sin(t * 0.45 + seed * 3) > 0.7 ? 1.4 : Math.sin(t * 0.45 + seed * 3) < -0.8 ? -1.4 : 0;
      break;
    case 'thinking':
      pose.arms = 'chin';
      pose.headDx = 0.8;
      pose.headDy = -0.6 + Math.sin(t * 1.2 + seed) * 0.5;
      break;
    case 'reading':
      pose.headDx = -2;
      pose.headDy = 1.8;
      pose.bob = Math.sin(t * 0.8 + seed) * 0.4;
      break;
    case 'writing':
      pose.arms = 'type';
      pose.headDx = -1.2;
      pose.headDy = 1.2;
      break;
    case 'running':
      pose.arms = 'type';
      pose.headDx = -2.2;
      pose.headDy = 0.6;
      break;
    case 'talking':
      pose.arms = 'gesture';
      pose.bob = Math.abs(Math.sin(t * 5)) * 1.1;
      break;
    case 'delegating':
      pose.arms = 'gesture';
      pose.headDx = 1.5;
      break;
    case 'asking':
      pose.arms = 'raise';
      pose.bob = Math.abs(Math.sin(t * 3)) * 1.5;
      break;
    case 'done':
      pose.arms = since < 2.5 ? 'stretch' : 'none';
      pose.bob = since < 2.5 ? Math.abs(Math.sin(t * 4)) * 1.5 : 0;
      break;
  }
  return pose;
}

export function drawFigure(ctx: CanvasRenderingContext2D, foot: Point, pose: Pose, accent: string, t: number, ring?: string): void {
  const x = foot.x;
  const walking = pose.walk >= 0;
  const baseline = foot.y - pose.bob;
  const bodyBottom = walking ? baseline - 9 : baseline;
  const top = baseline - BODY_H;

  // Ombre et anneau d'état
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ellipse(ctx, x, foot.y, 11, 4.6);
  ctx.fill();
  if (ring) {
    ctx.strokeStyle = withAlpha(ring, 0.75);
    ctx.lineWidth = 1.6;
    ellipse(ctx, x, foot.y, 15, 6.2);
    ctx.stroke();
  }

  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (walking) {
    const swing = Math.sin(pose.walk) * 4;
    ctx.lineWidth = 4.6;
    ctx.beginPath();
    ctx.moveTo(x - 2.6, bodyBottom - 2);
    ctx.lineTo(x - 2.6 + swing, baseline - 1);
    ctx.moveTo(x + 2.6, bodyBottom - 2);
    ctx.lineTo(x + 2.6 - swing, baseline - 1);
    ctx.stroke();
  }

  // Corps : épaules arrondies, légèrement évasé vers le bas
  ctx.beginPath();
  ctx.moveTo(x - 9, top + 9);
  ctx.quadraticCurveTo(x - 9, top, x, top);
  ctx.quadraticCurveTo(x + 9, top, x + 9, top + 9);
  ctx.lineTo(x + 7, bodyBottom);
  ctx.lineTo(x - 7, bodyBottom);
  ctx.closePath();
  ctx.fill();

  // Tête, détachée du corps comme sur un pictogramme
  ctx.beginPath();
  ctx.arc(x + pose.headDx, top - HEAD_R - 2.2 + pose.headDy, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  drawArms(ctx, x, top, pose, accent, t);

  // Badge de couleur de l'agent
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(x + 2, top + 9, 4.5, 6, 1.2);
  ctx.fill();
}

function drawArms(ctx: CanvasRenderingContext2D, x: number, top: number, pose: Pose, accent: string, t: number): void {
  const arm = (points: [number, number][]) => {
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    points.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, top + py) : ctx.moveTo(x + px, top + py)));
    ctx.stroke();
  };
  switch (pose.arms) {
    case 'type': {
      const a = Math.sin(t * 22) * 1.6;
      const b = Math.sin(t * 22 + 2) * 1.6;
      arm([[-8, 6], [-12, 14], [-9, 19 + a]]);
      arm([[8, 6], [12, 14], [9, 19 + b]]);
      break;
    }
    case 'chin':
      arm([[8, 6], [13, 15], [5, 2]]);
      break;
    case 'raise':
      arm([[8, 5], [12, -6], [13, -18 + Math.sin(t * 6) * 1.5]]);
      break;
    case 'stretch':
      arm([[-8, 5], [-12, -6], [-14, -17]]);
      arm([[8, 5], [12, -6], [14, -17]]);
      break;
    case 'gesture':
      arm([[8, 6], [13, 13], [16, 8 + Math.sin(t * 5) * 4]]);
      break;
    case 'carry': {
      const f = pose.facing;
      arm([[8 * f, 6], [12 * f, 14], [14 * f, 12]]);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(x + 11 * f - 4.5, top + 5, 9, 11, 1.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x + 11 * f - 3, top + 7, 6, 1.4);
      ctx.fillStyle = INK;
      break;
    }
    default:
      break;
  }
}

/** Hauteur de la silhouette au-dessus du point d'appui (pour bulles et sélection). */
export const FIGURE_HEIGHT = BODY_H + HEAD_R * 2 + 3;
