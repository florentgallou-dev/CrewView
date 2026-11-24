// Scène : réception de l'état, boucle d'animation et interface (bulles, dialogue, panneau).
// Dans VS Code, la sélection est partagée avec la barre latérale (qui affiche la fiche de l'agent) ;
// dans le navigateur, la fiche s'affiche dans un panneau flottant.

import type { AgentStatus, ClientMessage, HostMessage, Move, RoomLayout, SceneAgent, SceneState } from '../types';
import { renderAgentDetail } from './detail';
import { el, fill } from './dom';
import { drawFigure, FIGURE_HEIGHT, poseFor } from './figure';
import { iso, type Point } from './iso';
import { agentLevel, beaconLevel, createLegend, drawGear, gearBounds } from './beacon';
import { layoutLabels, type LabelRequest, type Obstacle, type Offset, type Rect } from './labels';
import { decorDrawables, deskDepth, doorOf, drawDesk, drawDeskFloor, drawRoom, type Drawable, WALL_HEIGHT } from './room';
import { setTheme } from './sprites';
import { BUBBLE_TTL_MS, STATUS_COLORS, STATUS_LABELS } from './status';
import { addStop, type FloorPlan, isHeadingTo, startArrival, startDelivery, stepWalker, visitorSpot, type Vec2, type Walker } from './walk';

declare function acquireVsCodeApi(): { postMessage(message: ClientMessage): void };

const DIALOG_TTL_MS = 60_000;
/** Un déplacement constaté il y a plus longtemps n'est plus joué (rechargement de la vue, relecture). */
const MOVE_TTL_MS = 45_000;
/** Halte d'un agent venu rendre son rapport : si l'agent principal délègue pendant ce temps, il emporte le dossier. */
const REPORT_PAUSE_S = 3;
const DEFAULT_ROOM: RoomLayout = { width: 14, depth: 12.1, aisles: [0.7, 3.8, 7, 10.2, 13.3] };
const IN_VSCODE = document.body.dataset.transport === 'vscode';

// ---- Éléments de la page ----------------------------------------------------------------

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const overlay = document.getElementById('overlay')!;
const projectEl = document.getElementById('project')!;
const sessionEl = document.getElementById('session')!;
const dotEl = document.getElementById('status-dot')!;
const noticeEl = document.getElementById('notice')!;
const dialogEl = document.getElementById('dialog')!;
const dialogSpeakerEl = document.getElementById('dialog-speaker')!;
const dialogTextEl = document.getElementById('dialog-text')!;
const panelEl = document.getElementById('panel')!;
const recenterEl = document.getElementById('recenter') as HTMLButtonElement;
const showBeaconLevel = createLegend(document.getElementById('legend')!);

// ---- État ----------------------------------------------------------------------------------

let state: SceneState | undefined;
let selectedId: string | undefined;
let connected = false;
const walkers = new Map<string, Walker>();
const bubbles = new Map<string, HTMLDivElement>();
const nameplates = new Map<string, HTMLDivElement>();
/** Taille mesurée de chaque étiquette, remesurée seulement quand son contenu change. */
const labelSizes = new WeakMap<HTMLElement, { key: string; width: number; height: number }>();
/** Décalage affiché de chaque étiquette, qui rejoint en douceur le décalage calculé. */
const labelOffsets = new Map<string, Offset>();
const seenAgents = new Set<string>();
const seeds = new Map<string, number>();
const statusSince = new Map<string, { status: AgentStatus; at: number }>();
const playedMoves = new Set<string>();
let camera = { scale: 1, ox: 0, oy: 0 };
/** Zoom et déplacement choisis par l'utilisateur, appliqués par-dessus le cadrage automatique. */
const view = { zoom: 1, panX: 0, panY: 0 };
let fit = { scale: 1, ox: 0, oy: 0 };

// ---- Transport -------------------------------------------------------------------------------

const send = connect();

function connect(): (message: ClientMessage) => void {
  if (IN_VSCODE) {
    const vscode = acquireVsCodeApi();
    window.addEventListener('message', (event) => onMessage(event.data as HostMessage));
    vscode.postMessage({ type: 'ready' });
    connected = true;
    return (message) => vscode.postMessage(message);
  }
  const source = new EventSource('events');
  source.onopen = () => setConnected(true);
  source.onerror = () => setConnected(false);
  source.onmessage = (event) => onMessage(JSON.parse(event.data) as HostMessage);
  return () => undefined;
}

function setConnected(value: boolean): void {
  connected = value;
  renderHeader();
}

function onMessage(message: HostMessage): void {
  if (message.type === 'state') {
    const first = !state;
    state = message.state;
    for (const agent of state.agents) {
      if (!seeds.has(agent.id)) seeds.set(agent.id, Math.random() * 10);
      // Un intérimaire qui apparaît en direct entre par la porte.
      if (!first && agent.temp && !seenAgents.has(agent.id)) {
        const door = doorOf(room());
        walkers.set(agent.id, startArrival([0.35, door.y + door.width / 2], agent.spot, plan()));
      }
      seenAgents.add(agent.id);
      const since = statusSince.get(agent.id);
      if (!since || since.status !== agent.runtime.status) statusSince.set(agent.id, { status: agent.runtime.status, at: performance.now() });
    }
    playMoves(state.moves);
    renderHeader();
    renderDialog();
    if (selectedId) renderPanel();
  } else if (message.type === 'selection') {
    selectedId = message.agentId;
    renderDialog();
  } else if (message.type === 'theme') {
    setTheme(message.layers);
  }
}

/**
 * Joue les déplacements pas encore montrés. Ils viennent de l'état (et non d'événements éphémères) :
 * rien n'est perdu si la vue était fermée, rechargée ou reconnectée.
 */
function playMoves(moves: Move[]): void {
  for (const move of moves) {
    if (playedMoves.has(move.id)) continue;
    playedMoves.add(move.id);
    if (Date.now() - move.at > MOVE_TTL_MS) continue;
    if (move.kind === 'report') {
      deliver(move.from, move.to, REPORT_PAUSE_S);
    } else if (!relay(move)) {
      deliver(move.from, move.to);
    }
  }
}

/**
 * Passage de relais : si un agent est en route (ou en halte) vers l'agent principal pour rendre son rapport
 * au moment où celui-ci délègue, c'est lui qui emporte le dossier jusqu'au suivant.
 */
function relay(move: Move): boolean {
  const to = agentById(move.to);
  if (!to) return false;
  for (const [agentId, walker] of walkers) {
    if (agentId === move.to || agentId === move.from || !isHeadingTo(walker, move.from)) continue;
    // Le rapport est remis, puis l'agent repart directement vers le suivant.
    walker.stops.splice(1, 0, { to: move.to, target: visitorSpot(to.desk) });
    if (walker.phase === 'pause') walker.pauseLeft = Math.min(walker.pauseLeft, 1);
    return true;
  }
  return false;
}

function deliver(fromId: string, toId: string, pause?: number): void {
  const from = agentById(fromId);
  const to = agentById(toId);
  if (!from || !to || from === to) return;
  const stop = { to: toId, target: visitorSpot(to.desk), pause };
  const walker = walkers.get(fromId);
  if (walker) addStop(walker, stop, plan());
  else walkers.set(fromId, startDelivery(from.spot, stop, plan()));
}

const agentById = (id: string) => state?.agents.find((a) => a.id === id);
const room = (): RoomLayout => state?.room ?? DEFAULT_ROOM;
const plan = (): FloorPlan => ({ desks: state?.agents.map((a) => a.desk) ?? [], aisles: room().aisles });

// ---- Rendu ----------------------------------------------------------------------------------

let lastFrame = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = now / 1000;
  resize();

  for (const [id, walker] of walkers) {
    const agent = agentById(id);
    if (!agent) {
      walkers.delete(id);
      continue;
    }
    if (stepWalker(walker, dt, agent.spot, plan()) === 'done') walkers.delete(id);
  }

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.ox, dpr * camera.oy);

  const agents = state?.agents ?? [];
  const boss = agents.find((a) => a.isMain);
  const beacon = beaconLevel(
    agents.map((a) => a.runtime.status),
    agents.some((a) => a.runtime.background.length > 0),
  );
  showBeaconLevel(beacon);
  drawRoom(ctx, state?.project ?? '', room(), boss?.desk.x ?? room().width / 2 - 1.2, beacon, t);
  for (const agent of agents) drawDeskFloor(ctx, agent, agent.id === selectedId);

  const drawables: Drawable[] = [...decorDrawables(room())];
  for (const agent of agents) {
    drawables.push({ depth: deskDepth(agent), draw: (c, time) => drawDesk(c, agent, time) });
    const position = positionOf(agent);
    drawables.push({ depth: position[0] + position[1], draw: (c, time) => drawAgent(c, agent, position, time) });
  }
  drawables.sort((a, b) => a.depth - b.depth).forEach((d) => d.draw(ctx, t));

  const leaders = updateLabels(agents, dt);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLeaders(ctx, leaders);
  requestAnimationFrame(frame);
}

function positionOf(agent: SceneAgent): Vec2 {
  return walkers.get(agent.id)?.pos ?? agent.spot;
}

function drawAgent(c: CanvasRenderingContext2D, agent: SceneAgent, position: Vec2, t: number): void {
  const walker = walkers.get(agent.id);
  const status = agent.runtime.status;
  const since = (performance.now() - (statusSince.get(agent.id)?.at ?? 0)) / 1000;
  const pose = poseFor(status, t, since, seeds.get(agent.id) ?? 0);
  if (walker && walker.phase !== 'pause') {
    pose.walk = walker.stride;
    pose.bob = Math.abs(Math.sin(walker.stride)) * 1.2;
    pose.arms = walker.carrying ? 'carry' : 'none';
    pose.facing = walker.facing;
    pose.headDx = walker.facing * 1.2;
    pose.headDy = 0;
  } else if (walker) {
    // Halte chez un collègue : face à lui, de dos pour nous.
    pose.arms = 'gesture';
    pose.back = true;
  }
  const ring = agent.id === selectedId ? agent.color : status !== 'idle' ? STATUS_COLORS[status] : undefined;
  const foot = iso(position[0], position[1]);
  drawFigure(c, foot, pose, agent.color, t, ring);
  // Engrenage de la couleur de son état, en haut à droite de la tête (les bulles s'affichent au-dessus).
  const level = agentLevel(agent.runtime);
  if (level) drawGear(c, { x: foot.x, y: foot.y - FIGURE_HEIGHT - pose.bob }, level, t);
}

/** Cadrage automatique de toute la salle, puis zoom et déplacement de l'utilisateur. */
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const { width: W, depth: D } = room();
  const minX = iso(0, D).x - 10;
  const maxX = iso(W, 0).x + 10;
  const minY = iso(0, 0, WALL_HEIGHT).y - 10;
  const maxY = iso(W, D).y + 24;
  // Marges fixes : la barre de dialogue flotte au-dessus de la scène sans la recadrer.
  const top = 52;
  const bottom = 24;
  const scale = Math.min((width - 24) / (maxX - minX), (height - top - bottom) / (maxY - minY), 2.4);
  fit = {
    scale,
    ox: (width - (maxX - minX) * scale) / 2 - minX * scale,
    oy: top + (height - top - bottom - (maxY - minY) * scale) / 2 - minY * scale,
  };
  camera = { scale: fit.scale * view.zoom, ox: fit.ox * view.zoom + view.panX, oy: fit.oy * view.zoom + view.panY };
}

/** Zoom à la molette, centré sur le pointeur (de 0,8 × à 5 × le cadrage complet). */
function zoomAt(clientX: number, clientY: number, factor: number): void {
  const zoom = Math.min(5, Math.max(0.8, view.zoom * factor));
  const ratio = zoom / view.zoom;
  // Le point de la salle sous le pointeur reste sous le pointeur.
  const ox = clientX - (clientX - camera.ox) * ratio;
  const oy = clientY - (clientY - camera.oy) * ratio;
  view.zoom = zoom;
  view.panX = ox - fit.ox * zoom;
  view.panY = oy - fit.oy * zoom;
  updateRecenter();
}

function recenter(): void {
  view.zoom = 1;
  view.panX = 0;
  view.panY = 0;
  updateRecenter();
}

function updateRecenter(): void {
  recenterEl.hidden = Math.abs(view.zoom - 1) < 0.01 && Math.abs(view.panX) < 1 && Math.abs(view.panY) < 1;
}

function toScreen(p: Point): Point {
  return { x: p.x * camera.scale + camera.ox, y: p.y * camera.scale + camera.oy };
}

// ---- Noms et bulles ---------------------------------------------------------------------------

interface Leader {
  from: Point;
  to: Point;
}

/** Au-delà de ce décalage, un trait relie l'étiquette à son agent (un nom proche de son bureau reste lisible sans). */
const LEADER_MIN_PX = { name: 22, bubble: 10 };

/**
 * Noms et bulles de tous les agents, placés ensemble de l'avant vers le fond : aucun ne masque une autre
 * étiquette, la silhouette ou l'engrenage d'un autre agent. Renvoie les traits de rappel des étiquettes déplacées.
 */
function updateLabels(agents: SceneAgent[], dt: number): Leader[] {
  const now = Date.now();
  const s = camera.scale;
  const requests: LabelRequest[] = [];
  const obstacles: Obstacle[] = [];
  const anchors = new Map<string, Point>();
  const elements = new Map<string, HTMLDivElement>();
  const alive = new Set<string>();

  for (const agent of agents) {
    const position = positionOf(agent);
    const foot = toScreen(iso(position[0], position[1]));
    const headTop = { x: foot.x, y: foot.y - FIGURE_HEIGHT * s };
    obstacles.push({ owner: agent.id, rect: { left: foot.x - 11 * s, right: foot.x + 11 * s, top: headTop.y - 2 * s, bottom: foot.y + 2 * s } });
    if (agentLevel(agent.runtime)) {
      // Les engrenages sont une information : même les étiquettes de leur agent les évitent.
      const box = gearBounds();
      obstacles.push({ owner: `engrenage:${agent.id}`, rect: { left: headTop.x + box.left * s, right: headTop.x + box.right * s, top: headTop.y + box.top * s, bottom: headTop.y + box.bottom * s } });
    }

    // Nom, au sol devant le bureau.
    const { x, y, w, d } = agent.desk;
    const nameId = `name:${agent.id}`;
    const name = nameplateOf(agent);
    const nameSize = sizeOf(name, `${name.className}|${name.textContent}`);
    const nameCenter = toScreen(iso(x + w / 2, y + d + 1.05));
    requests.push({ id: nameId, owner: agent.id, kind: 'name', depth: x + w / 2 + y + d + 1.05, x: nameCenter.x - nameSize.width / 2, y: nameCenter.y - nameSize.height / 2, ...nameSize });
    anchors.set(nameId, nameCenter);
    elements.set(nameId, name);
    alive.add(nameId);

    // Bulle, au-dessus de la tête.
    const content = bubbleContent(agent, now);
    if (!content) continue;
    const bubbleId = `bubble:${agent.id}`;
    const bubble = bubbleOf(agent, content);
    const size = sizeOf(bubble, `${bubble.className}|${content.text}`);
    requests.push({ id: bubbleId, owner: agent.id, kind: 'bubble', depth: position[0] + position[1], x: headTop.x - size.width / 2, y: headTop.y - 8 - size.height, ...size });
    anchors.set(bubbleId, headTop);
    elements.set(bubbleId, bubble);
    alive.add(bubbleId);
  }

  const targets = layoutLabels(requests, obstacles);
  const ease = 1 - Math.exp(-dt / 0.035);
  const leaders: Leader[] = [];
  for (const request of requests) {
    const target = targets.get(request.id) ?? { dx: 0, dy: 0 };
    const current = labelOffsets.get(request.id) ?? target;
    const offset = { dx: current.dx + (target.dx - current.dx) * ease, dy: current.dy + (target.dy - current.dy) * ease };
    labelOffsets.set(request.id, offset);
    const element = elements.get(request.id)!;
    const rect: Rect = { left: request.x + offset.dx, top: request.y + offset.dy, right: request.x + offset.dx + request.width, bottom: request.y + offset.dy + request.height };
    element.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    element.style.zIndex = String(Math.round(request.depth * 10) * 2 + (request.kind === 'bubble' ? 1 : 0));
    const moved = Math.hypot(offset.dx, offset.dy) > LEADER_MIN_PX[request.kind];
    // Bulle déplacée : sa pointe ne désignerait plus le bon agent, un trait de rappel la remplace.
    if (request.kind === 'bubble') element.classList.toggle('shifted', moved);
    if (moved) {
      const to = anchors.get(request.id)!;
      leaders.push({ from: { x: Math.min(Math.max(to.x, rect.left), rect.right), y: Math.min(Math.max(to.y, rect.top), rect.bottom) }, to });
    }
  }

  for (const [id, element] of [...bubbles].map(([agentId, e]) => [`bubble:${agentId}`, e] as const)) {
    if (alive.has(id)) continue;
    element.remove();
    bubbles.delete(id.slice('bubble:'.length));
    labelOffsets.delete(id);
  }
  for (const [agentId, element] of nameplates) {
    if (alive.has(`name:${agentId}`)) continue;
    element.remove();
    nameplates.delete(agentId);
    labelOffsets.delete(`name:${agentId}`);
  }
  return leaders;
}

function drawLeaders(c: CanvasRenderingContext2D, leaders: Leader[]): void {
  c.strokeStyle = 'rgba(22,24,27,0.38)';
  c.fillStyle = 'rgba(22,24,27,0.5)';
  c.lineWidth = 1;
  for (const { from, to } of leaders) {
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(to.x, to.y);
    c.stroke();
    c.beginPath();
    c.arc(to.x, to.y, 2, 0, Math.PI * 2);
    c.fill();
  }
}

function sizeOf(element: HTMLElement, key: string): { width: number; height: number } {
  const known = labelSizes.get(element);
  if (known?.key === key) return known;
  const size = { key, width: element.offsetWidth, height: element.offsetHeight };
  labelSizes.set(element, size);
  return size;
}

function nameplateOf(agent: SceneAgent): HTMLDivElement {
  let element = nameplates.get(agent.id);
  if (!element) {
    element = document.createElement('div');
    element.innerHTML = '<span class="nameplate-dot"></span><span class="nameplate-text"></span>';
    overlay.appendChild(element);
    nameplates.set(agent.id, element);
  }
  element.className = `nameplate${agent.id === selectedId ? ' selected' : ''}`;
  element.style.setProperty('--agent', agent.color);
  const text = agent.temp ? `${agent.name} · intérim` : agent.name;
  const textEl = element.lastElementChild as HTMLSpanElement;
  if (textEl.textContent !== text) textEl.textContent = text;
  return element;
}

function bubbleOf(agent: SceneAgent, content: { text: string; kind: string }): HTMLDivElement {
  let element = bubbles.get(agent.id);
  if (!element) {
    element = document.createElement('div');
    element.innerHTML = '<div class="bubble-text"></div>';
    overlay.appendChild(element);
    bubbles.set(agent.id, element);
  }
  const shifted = element.classList.contains('shifted');
  element.className = `bubble ${content.kind}${shifted ? ' shifted' : ''}`;
  element.style.setProperty('--status', STATUS_COLORS[agent.runtime.status]);
  const textEl = element.firstElementChild as HTMLDivElement;
  if (textEl.dataset.text !== content.text) {
    textEl.dataset.text = content.text;
    textEl.textContent = content.text;
  }
  return element;
}

function bubbleContent(agent: SceneAgent, now: number): { text: string; kind: string } | undefined {
  const { status, bubble } = agent.runtime;
  const fresh = bubble && now - bubble.at < BUBBLE_TTL_MS;
  if (status === 'thinking') {
    // L'engrenage orange montre déjà la réflexion : une bulle seulement quand son texte est exposé.
    return bubble?.kind === 'think' && fresh ? { text: bubble.text, kind: 'think' } : undefined;
  }
  if (status === 'asking' && bubble) return { text: bubble.text, kind: 'ask' };
  if (!bubble || !fresh || status === 'idle') return undefined;
  return { text: bubble.text, kind: bubble.kind };
}

// ---- En-tête, dialogue, panneau ---------------------------------------------------------------

function renderHeader(): void {
  projectEl.textContent = state?.project ?? 'Crew View';
  sessionEl.textContent = state?.sessionTitle ? `· ${state.sessionTitle}` : '';
  dotEl.className = `dot ${connected && state?.watching ? 'live' : ''}`;
  dotEl.title = connected ? (state?.watching ? 'Session suivie en direct' : 'Aucune session') : 'Déconnecté';
  noticeEl.hidden = !state?.notice;
  noticeEl.textContent = state?.notice ?? '';
}

function renderDialog(): void {
  const selected = selectedId ? agentById(selectedId) : undefined;
  let speaker: string | undefined;
  let text: string | undefined;
  if (selected) {
    const last = selected.runtime.history[selected.runtime.history.length - 1];
    speaker = selected.name;
    text = last ? `${STATUS_LABELS[selected.runtime.status]} — ${last.text}` : STATUS_LABELS[selected.runtime.status];
  } else if (state?.dialog && Date.now() - state.dialog.at < DIALOG_TTL_MS) {
    speaker = state.dialog.speaker;
    text = state.dialog.text;
  }
  dialogEl.hidden = !text;
  dialogSpeakerEl.textContent = speaker ? `${speaker} :` : '';
  dialogTextEl.textContent = text ?? '';
}

/** Panneau flottant (navigateur uniquement ; dans VS Code la fiche est dans la barre latérale). */
function renderPanel(): void {
  const agent = !IN_VSCODE && selectedId ? agentById(selectedId) : undefined;
  panelEl.hidden = !agent;
  if (!agent) return;
  fill(panelEl, [
    el('button', { className: 'close', title: 'Fermer', onclick: () => select(undefined) }, '×'),
    ...renderAgentDetail(agent, {
      requests: state?.requests,
      isOpen: (key, byDefault) => panelFolds[key] ?? byDefault,
      onToggle: (key, open) => {
        panelFolds[key] = open;
      },
    }),
  ]);
}

/** Sections repliées du panneau (navigateur : mémorisées le temps de la page). */
const panelFolds: Record<string, boolean> = {};

function select(id: string | undefined): void {
  if (IN_VSCODE) {
    // L'extension renvoie la sélection à toutes les vues, y compris celle-ci.
    send({ type: 'select', agentId: id });
    return;
  }
  selectedId = id;
  renderPanel();
  renderDialog();
}

// ---- Interaction -------------------------------------------------------------------------------

function agentAt(clientX: number, clientY: number): SceneAgent | undefined {
  const agents = [...(state?.agents ?? [])].sort((a, b) => positionOf(b)[0] + positionOf(b)[1] - (positionOf(a)[0] + positionOf(a)[1]));
  for (const agent of agents) {
    const [x, y] = positionOf(agent);
    const foot = toScreen(iso(x, y));
    const half = 13 * camera.scale;
    if (clientX > foot.x - half && clientX < foot.x + half && clientY < foot.y + 4 * camera.scale && clientY > foot.y - FIGURE_HEIGHT * camera.scale) return agent;
  }
  for (const agent of agents) {
    const { x, y, w, d } = agent.desk;
    const corners = [iso(x, y, 0.75), iso(x + w, y, 0.75), iso(x + w, y + d, 0), iso(x, y + d, 0)].map(toScreen);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    if (clientX > Math.min(...xs) && clientX < Math.max(...xs) && clientY > Math.min(...ys) && clientY < Math.max(...ys)) return agent;
  }
  return undefined;
}

// Glisser pour se déplacer dans la salle ; un clic sans glisser sélectionne un agent.
let drag: { x: number; y: number; moved: boolean } | undefined;
canvas.addEventListener('mousedown', (event) => {
  if (event.button === 0) drag = { x: event.clientX, y: event.clientY, moved: false };
});
window.addEventListener('mousemove', (event) => {
  if (drag && (event.buttons & 1)) {
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.moved || Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      view.panX += dx;
      view.panY += dy;
      drag.x = event.clientX;
      drag.y = event.clientY;
      updateRecenter();
    }
  }
  if (event.target === canvas) {
    canvas.style.cursor = drag?.moved ? 'grabbing' : agentAt(event.clientX, event.clientY) ? 'pointer' : 'grab';
  }
});
window.addEventListener('mouseup', () => {
  setTimeout(() => (drag = undefined), 0);
});
canvas.addEventListener('click', (event) => {
  if (!drag?.moved) select(agentAt(event.clientX, event.clientY)?.id);
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
}, { passive: false });
canvas.addEventListener('dblclick', (event) => {
  if (!agentAt(event.clientX, event.clientY)) recenter();
});
recenterEl.addEventListener('click', recenter);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') select(undefined);
});
// Le dialogue expire même sans nouvel état.
setInterval(renderDialog, 2_000);

renderHeader();
requestAnimationFrame(frame);
