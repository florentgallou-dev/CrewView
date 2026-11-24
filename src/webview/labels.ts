// Placement des informations des agents (noms et bulles) pour qu'aucune ne masque une autre information,
// une silhouette ou un engrenage. Sans DOM : testable seul.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LabelRequest {
  id: string;
  /** Agent propriétaire : sa propre silhouette n'est pas un obstacle. */
  owner: string;
  kind: 'name' | 'bubble';
  /** Profondeur dans la salle : les étiquettes les plus proches du spectateur sont placées d'abord. */
  depth: number;
  /** Position naturelle (coin haut gauche, pixels écran) et taille. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Obstacle {
  owner: string;
  rect: Rect;
}

export interface Offset {
  dx: number;
  dy: number;
}

const MARGIN = 3;

/** Décalages candidats, du plus proche au plus lointain ; les bulles ne descendent jamais. */
function candidates(kind: LabelRequest['kind'], scale: number): Offset[] {
  const list: Offset[] = [];
  const step = 6 * scale;
  if (kind === 'name') {
    for (let i = -12; i <= 12; i++) for (const dx of [0, -40, 40, -80, 80]) list.push({ dx: dx * scale, dy: i * step });
  } else {
    for (let i = 0; i <= 26; i++) for (const dx of [0, -50, 50, -100, 100]) list.push({ dx: dx * scale, dy: 0 - i * step });
  }
  return list.sort((a, b) => cost(a) - cost(b));
}

/** Un décalage latéral coûte plus qu'un décalage vertical : l'étiquette reste au-dessus de son agent. */
function cost(o: Offset): number {
  return Math.abs(o.dx) * 1.6 + Math.abs(o.dy);
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left) + MARGIN;
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + MARGIN;
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Place les étiquettes de l'avant vers le fond. Chacune évite les étiquettes déjà posées et les obstacles
 * (silhouettes et engrenages) des autres agents, avec le plus petit décalage possible ; à défaut de place libre,
 * elle prend la position qui chevauche le moins.
 */
export function layoutLabels(labels: LabelRequest[], obstacles: Obstacle[], scale = 1): Map<string, Offset> {
  const result = new Map<string, Offset>();
  const placed: Rect[] = [];
  const ordered = [...labels].sort((a, b) => b.depth - a.depth || (a.kind === b.kind ? 0 : a.kind === 'name' ? -1 : 1));
  const lists = { name: candidates('name', scale), bubble: candidates('bubble', scale) };
  for (const label of ordered) {
    const blockers = [...placed, ...obstacles.filter((o) => o.owner !== label.owner).map((o) => o.rect)];
    let best: { offset: Offset; rect: Rect; score: number } | undefined;
    for (const offset of lists[label.kind]) {
      const rect = { left: label.x + offset.dx, top: label.y + offset.dy, right: label.x + offset.dx + label.width, bottom: label.y + offset.dy + label.height };
      const score = blockers.reduce((sum, b) => sum + overlap(rect, b), 0);
      if (!best || score < best.score) best = { offset, rect, score };
      if (score === 0) break;
    }
    result.set(label.id, best!.offset);
    placed.push(best!.rect);
  }
  return result;
}
