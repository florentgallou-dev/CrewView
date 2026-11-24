// Images SVG du thème : chargement, couleur de l'agent (currentColor) et dessin à leur point d'ancrage.
// Convention : 1 unité SVG = 1 pixel de scène au zoom 1 ; l'origine (0,0) du SVG est le point d'ancrage.

import type { ThemeLayers } from '../themeFiles';
import type { Point } from './iso';

export interface Sprite {
  img: HTMLImageElement;
  /** Boîte du viewBox, relative au point d'ancrage. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pivots {
  tete: [number, number];
  epaule: [number, number];
  hanche: [number, number];
  dossier: [number, number];
  longueurs: { bras: number; 'avant-bras': number; jambe: number };
  /** Engrenages d'un agent occupé : nombre de dents et centre, par rapport au sommet de la tête. */
  engrenages: { grand: GearPivot; petit: GearPivot };
}

export interface GearPivot {
  dents: number;
  centre: [number, number];
}

const DEFAULT_PIVOTS: Pivots = {
  tete: [0, -9.4],
  epaule: [8, 6],
  hanche: [2.6, -2],
  dossier: [11, 10.5],
  longueurs: { bras: 10, 'avant-bras': 10, jambe: 10 },
  engrenages: { grand: { dents: 14, centre: [13, -2] }, petit: { dents: 9, centre: [21.95, 4.27] } },
};

let layers: ThemeLayers = [];
let currentPivots: Pivots = DEFAULT_PIVOTS;
/** Par image et couleur : couche utilisée (on passe à la suivante si le fichier est illisible) et image. */
const cache = new Map<string, { layer: number; sprite?: Sprite }>();

export function setTheme(next: ThemeLayers): void {
  layers = next;
  cache.clear();
  currentPivots = readPivots();
}

export function pivots(): Pivots {
  return currentPivots;
}

/** Image prête à dessiner, ou undefined (pas encore chargée, ou absente de toutes les couches). */
export function sprite(name: string, color?: string): Sprite | undefined {
  const key = `${name}|${color ?? ''}`;
  let entry = cache.get(key);
  if (!entry) {
    load(key, name, color, 0);
    entry = cache.get(key)!;
  }
  const s = entry.sprite;
  return s && s.img.complete && s.img.naturalWidth > 0 ? s : undefined;
}

/** Dessine l'image avec son ancre en (x, y), éventuellement mise à l'échelle autour de l'ancre. */
export function drawSprite(ctx: CanvasRenderingContext2D, name: string, at: Point, color?: string, sx = 1, sy = sx): void {
  const s = sprite(name, color);
  if (s) ctx.drawImage(s.img, at.x + s.x * sx, at.y + s.y * sy, s.w * sx, s.h * sy);
}

/** Dessine l'image étirée sur un rectangle (dalles d'écran). */
export function drawSpriteIn(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number, color?: string): void {
  const s = sprite(name, color);
  if (s) ctx.drawImage(s.img, x, y, w, h);
}

/** Membre : image horizontale de longueur nominale, tournée et étirée pour relier a à b. */
export function drawSegment(ctx: CanvasRenderingContext2D, name: string, a: Point, b: Point, nominal: number): void {
  const s = sprite(name);
  if (!s) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  ctx.scale(length / (nominal || 1), 1);
  ctx.drawImage(s.img, s.x, s.y, s.w, s.h);
  ctx.restore();
}

function load(key: string, name: string, color: string | undefined, from: number): void {
  for (let layer = from; layer < layers.length; layer++) {
    const text = layers[layer][name];
    if (!text) continue;
    const prepared = prepare(text, color);
    if (!prepared) {
      console.warn(`Crew View : ${name} ignoré (balise <svg> sans viewBox ni width/height)`);
      continue;
    }
    const img = new Image();
    const sprite: Sprite = { img, ...prepared.box };
    img.onerror = () => {
      console.warn(`Crew View : ${name} illisible, fichier de la couche suivante utilisé`);
      load(key, name, color, layer + 1);
    };
    img.src = prepared.url;
    cache.set(key, { layer, sprite });
    return;
  }
  cache.set(key, { layer: layers.length });
}

/**
 * Fixe la taille intrinsèque de l'image à celle du viewBox (1 unité = 1 pixel)
 * et la couleur héritée par currentColor.
 */
function prepare(text: string, color: string | undefined): { url: string; box: Omit<Sprite, 'img'> } | undefined {
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return undefined;
  let tag = open[0];
  const number = '([-+]?[\\d.]+(?:e[-+]?\\d+)?)';
  const viewBox = new RegExp(`viewBox\\s*=\\s*["']\\s*${number}[\\s,]+${number}[\\s,]+${number}[\\s,]+${number}`, 'i').exec(tag);
  const size = (attr: string) => Number(new RegExp(`\\s${attr}\\s*=\\s*["']\\s*${number}`, 'i').exec(tag)?.[1]);
  let box: Omit<Sprite, 'img'>;
  if (viewBox) box = { x: Number(viewBox[1]), y: Number(viewBox[2]), w: Number(viewBox[3]), h: Number(viewBox[4]) };
  else if (size('width') > 0 && size('height') > 0) box = { x: 0, y: 0, w: size('width'), h: size('height') };
  else return undefined;
  if (!(box.w > 0 && box.h > 0)) return undefined;

  tag = tag.replace(/\s(width|height|color)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const extra = [`width="${box.w}"`, `height="${box.h}"`];
  if (!viewBox) extra.push(`viewBox="0 0 ${box.w} ${box.h}"`);
  if (color) extra.push(`color="${color}"`);
  if (!/\sxmlns\s*=/.test(tag)) extra.push('xmlns="http://www.w3.org/2000/svg"');
  tag = tag.replace(/^<svg\b/i, `<svg ${extra.join(' ')}`);
  const svg = text.slice(0, open.index) + tag + text.slice(open.index + open[0].length);
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, box };
}

function readPivots(): Pivots {
  for (const layer of layers) {
    const text = layer['personnage/pivots.json'];
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Partial<Pivots>;
      const pair = (value: unknown, fallback: [number, number]): [number, number] =>
        Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number') ? [value[0], value[1]] : fallback;
      const lengths = (data.longueurs ?? {}) as Partial<Pivots['longueurs']>;
      const length = (value: unknown, fallback: number) => (typeof value === 'number' && value > 0 ? value : fallback);
      return {
        tete: pair(data.tete, DEFAULT_PIVOTS.tete),
        epaule: pair(data.epaule, DEFAULT_PIVOTS.epaule),
        hanche: pair(data.hanche, DEFAULT_PIVOTS.hanche),
        dossier: pair(data.dossier, DEFAULT_PIVOTS.dossier),
        longueurs: {
          bras: length(lengths.bras, DEFAULT_PIVOTS.longueurs.bras),
          'avant-bras': length(lengths['avant-bras'], DEFAULT_PIVOTS.longueurs['avant-bras']),
          jambe: length(lengths.jambe, DEFAULT_PIVOTS.longueurs.jambe),
        },
        engrenages: {
          grand: gearPivot(data.engrenages?.grand, DEFAULT_PIVOTS.engrenages.grand, pair),
          petit: gearPivot(data.engrenages?.petit, DEFAULT_PIVOTS.engrenages.petit, pair),
        },
      };
    } catch {
      console.warn('Crew View : personnage/pivots.json illisible, couche suivante utilisée');
    }
  }
  return DEFAULT_PIVOTS;
}

function gearPivot(value: Partial<GearPivot> | undefined, fallback: GearPivot, pair: (v: unknown, f: [number, number]) => [number, number]): GearPivot {
  const dents = typeof value?.dents === 'number' && value.dents >= 3 ? Math.round(value.dents) : fallback.dents;
  return { dents, centre: pair(value?.centre, fallback.centre) };
}
