// Silhouettes pictogrammes et leurs postures selon l'activité.
// Les pièces (tête, buste, membres, articulations) sont des images du thème, placées et tournées ici.

import type { AgentStatus } from '../types';
import { ellipse, type Point, withAlpha } from './iso';
import { drawSegment, drawSprite, pivots } from './sprites';

const HEAD_R = 7.2;
const BODY_H = 40;

export type Arms = 'none' | 'type' | 'elbows' | 'chin' | 'scratch' | 'raise' | 'stretch' | 'carry' | 'gesture';

export interface Pose {
  bob: number;
  headDx: number;
  headDy: number;
  arms: Arms;
  /** Phase de marche, ou -1 à l'arrêt. */
  walk: number;
  facing: 1 | -1;
  /** De dos, face à son écran (le badge de poitrine n'est alors pas visible). */
  back: boolean;
}

/**
 * Posture d'un agent à son poste selon son statut. `since` = secondes depuis le changement de statut.
 * Au travail, l'agent est de dos, tourné vers son écran (à sa droite à l'écran) ;
 * au repos, quand il parle, attend une réponse ou a fini, il se retourne vers la salle.
 */
export function poseFor(status: AgentStatus, t: number, since: number, seed: number): Pose {
  const pose: Pose = { bob: 0, headDx: 0, headDy: 0, arms: 'none', walk: -1, facing: 1, back: false };
  switch (status) {
    case 'idle':
      pose.bob = Math.sin(t * 1.4 + seed) * 0.6;
      pose.headDx = Math.sin(t * 0.45 + seed * 3) > 0.7 ? 1.4 : Math.sin(t * 0.45 + seed * 3) < -0.8 ? -1.4 : 0;
      break;
    case 'thinking':
      pose.back = true;
      pose.arms = 'scratch';
      pose.headDx = 0.6;
      pose.headDy = -0.6 + Math.sin(t * 1.2 + seed) * 0.5;
      break;
    case 'reading':
      pose.back = true;
      pose.headDx = 1.6;
      pose.headDy = 2.2;
      pose.bob = Math.sin(t * 0.8 + seed) * 0.4;
      break;
    case 'writing':
      pose.back = true;
      pose.arms = 'elbows';
      pose.headDx = 1.4;
      pose.headDy = 1.4;
      break;
    case 'running':
      pose.back = true;
      pose.arms = 'elbows';
      pose.headDx = 2;
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
  const pv = pivots();

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

  if (walking) {
    const swing = Math.sin(pose.walk) * 4;
    for (const side of [-1, 1]) {
      const hip = { x: x + side * pv.hanche[0], y: bodyBottom + pv.hanche[1] };
      limb(ctx, 'personnage/jambe.svg', pv.longueurs.jambe, [hip, { x: hip.x - side * swing, y: baseline - 1 }]);
    }
  }

  // Corps (compressé en hauteur pendant la marche, les jambes apparaissent dessous), puis tête détachée.
  drawSprite(ctx, pose.back ? 'personnage/buste-dos.svg' : 'personnage/buste.svg', { x, y: top }, accent, 1, (bodyBottom - top) / BODY_H);
  drawSprite(ctx, 'personnage/tete.svg', { x: x + pv.tete[0] + pose.headDx, y: top + pv.tete[1] + pose.headDy });

  drawArms(ctx, x, top, pose, accent, t);
}

/** Membre en deux segments au plus (bras + avant-bras, ou jambe), avec ses articulations. */
function limb(ctx: CanvasRenderingContext2D, name: string, nominal: number, points: Point[], forearm?: { name: string; nominal: number }): void {
  drawSegment(ctx, name, points[0], points[1], nominal);
  if (points[2] && forearm) drawSegment(ctx, forearm.name, points[1], points[2], forearm.nominal);
  for (const p of points) drawSprite(ctx, 'personnage/articulation.svg', p);
}

function drawArms(ctx: CanvasRenderingContext2D, x: number, top: number, pose: Pose, accent: string, t: number): void {
  const pv = pivots();
  // Les postures sont décrites pour des épaules en (±8, 6) : elles suivent l'épaule définie dans pivots.json.
  const arm = (points: [number, number][]) => {
    const side = Math.sign(points[0][0]) || 1;
    const dx = (pv.epaule[0] - 8) * side;
    const dy = pv.epaule[1] - 6;
    limb(ctx, 'personnage/bras.svg', pv.longueurs.bras, points.map(([px, py]) => ({ x: x + px + dx, y: top + py + dy })), {
      name: 'personnage/avant-bras.svg',
      nominal: pv.longueurs['avant-bras'],
    });
  };
  switch (pose.arms) {
    case 'type': {
      const a = Math.sin(t * 22) * 1.6;
      const b = Math.sin(t * 22 + 2) * 1.6;
      arm([[-8, 6], [-12, 14], [-9, 19 + a]]);
      arm([[8, 6], [12, 14], [9, 19 + b]]);
      break;
    }
    case 'elbows': {
      // De dos : les mains sont sur le clavier, seuls les coudes bougent.
      const a = Math.sin(t * 20) * 1.4;
      const b = Math.sin(t * 20 + 2) * 1.4;
      arm([[-8, 6], [-12.5, 14 + a], [-7, 19]]);
      arm([[8, 6], [12.5, 14 + b], [7, 19]]);
      break;
    }
    case 'chin':
      arm([[8, 6], [13, 15], [5, 2]]);
      break;
    case 'scratch':
      // De dos : main à l'arrière de la tête.
      arm([[8, 5], [13.5, -2], [5, -11 + Math.sin(t * 5) * 1.2]]);
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
      drawSprite(ctx, 'personnage/dossier.svg', { x: x + pv.dossier[0] * f, y: top + pv.dossier[1] }, accent);
      break;
    }
    default:
      break;
  }
}

/** Hauteur de la silhouette au-dessus du point d'appui (pour bulles et sélection). */
export const FIGURE_HEIGHT = BODY_H + HEAD_R * 2 + 3;
