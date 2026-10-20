// Projection isométrique et primitives de dessin.
// Monde : x vers la droite-avant, y vers la gauche-avant, z vers le haut, en tuiles.

export const TW = 64;
export const TH = 32;
export const TZ = 32;

export interface Point {
  x: number;
  y: number;
}

export type Vec3 = [number, number, number];

export function iso(x: number, y: number, z = 0): Point {
  return { x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 - z * TZ };
}

export function poly(ctx: CanvasRenderingContext2D, points: Vec3[], fill: string, stroke?: string): void {
  ctx.beginPath();
  points.forEach(([x, y, z], i) => {
    const p = iso(x, y, z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }
}

export interface BoxColors {
  top: string;
  /** Face orientée +y (avant-gauche à l'écran). */
  left: string;
  /** Face orientée +x (avant-droite à l'écran). */
  right: string;
  edge?: string;
}

export function box(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, w: number, d: number, h: number, c: BoxColors): void {
  poly(ctx, [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], c.left, c.edge);
  poly(ctx, [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], c.right, c.edge);
  poly(ctx, [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], c.top, c.edge);
}

/** Couleurs d'un parallélépipède à partir d'une teinte de base (ombrage des faces). */
export function shaded(base: string, edge?: string): BoxColors {
  return { top: shade(base, 0.08), left: shade(base, -0.1), right: shade(base, -0.22), edge };
}

/** Éclaircit (amount > 0) ou assombrit (amount < 0) une couleur #rrggbb. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Place le contexte sur le plan d'un mur : l'origine est le point monde donné,
 * l'axe x suit le mur dans le sens de lecture, l'axe y descend. 1 unité monde ≈ 35,8 px.
 */
export function onWall(ctx: CanvasRenderingContext2D, wall: 'back' | 'left', u: number, z: number): void {
  const origin = wall === 'back' ? iso(u, 0, z) : iso(0, u, z);
  ctx.translate(origin.x, origin.y);
  ctx.transform(0.894, wall === 'back' ? 0.447 : -0.447, 0, 1, 0, 0);
}

export const WALL_UNIT = Math.hypot(TW / 2, TH / 2);

export function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}
