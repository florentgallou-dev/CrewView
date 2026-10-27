// Scène : réception de l'état, boucle d'animation et interface (bulles, dialogue, panneau).
// Dans VS Code, la sélection est partagée avec la barre latérale (qui affiche la fiche de l'agent) ;
// dans le navigateur, la fiche s'affiche dans un panneau flottant.

import type { AgentStatus, ClientMessage, HostMessage, SceneAgent, SceneState } from '../types';
import { renderAgentDetail } from './detail';
import { el, fill } from './dom';
import { drawFigure, FIGURE_HEIGHT, poseFor } from './figure';
import { iso, type Point } from './iso';
import { decorDrawables, deskDepth, DOOR, drawDesk, drawDeskFloor, drawNameplate, drawRoom, type Drawable, ROOM } from './room';
import { BUBBLE_TTL_MS, STATUS_COLORS, STATUS_LABELS } from './status';
import { addStop, startArrival, startDelivery, stepWalker, visitorSpot, type Vec2, type Walker } from './walk';

declare function acquireVsCodeApi(): { postMessage(message: ClientMessage): void };

const DIALOG_TTL_MS = 60_000;
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

// ---- État ----------------------------------------------------------------------------------

let state: SceneState | undefined;
let selectedId: string | undefined;
let connected = false;
const walkers = new Map<string, Walker>();
const bubbles = new Map<string, HTMLDivElement>();
const seenAgents = new Set<string>();
const seeds = new Map<string, number>();
const statusSince = new Map<string, { status: AgentStatus; at: number }>();
let camera = { scale: 1, ox: 0, oy: 0 };

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
        walkers.set(agent.id, startArrival([0.35, DOOR.y + DOOR.width / 2], agent.spot, desks()));
      }
      seenAgents.add(agent.id);
      const since = statusSince.get(agent.id);
      if (!since || since.status !== agent.runtime.status) statusSince.set(agent.id, { status: agent.runtime.status, at: performance.now() });
    }
    renderHeader();
    renderDialog();
    if (selectedId) renderPanel();
  } else if (message.type === 'delegate' || message.type === 'report') {
    // Délégation : l'orchestrateur apporte le dossier ; rapport : l'agent rapporte le sien.
    deliver(message.from, message.to);
  } else if (message.type === 'selection') {
    selectedId = message.agentId;
    renderDialog();
  }
}

function deliver(fromId: string, toId: string): void {
  const from = agentById(fromId);
  const to = agentById(toId);
  if (!from || !to || from === to) return;
  const stop = { to: toId, target: visitorSpot(to.desk) };
  const walker = walkers.get(fromId);
  if (walker) addStop(walker, stop, desks());
  else walkers.set(fromId, startDelivery(from.spot, stop, desks()));
}

const agentById = (id: string) => state?.agents.find((a) => a.id === id);
const desks = () => state?.agents.map((a) => a.desk) ?? [];

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
    if (stepWalker(walker, dt, agent.spot, desks()) === 'done') walkers.delete(id);
  }

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.ox, dpr * camera.oy);

  drawRoom(ctx, state?.project ?? '');
  const agents = state?.agents ?? [];
  for (const agent of agents) drawDeskFloor(ctx, agent, agent.id === selectedId);

  const drawables: Drawable[] = [...decorDrawables()];
  for (const agent of agents) {
    drawables.push({ depth: deskDepth(agent), draw: (c, time) => drawDesk(c, agent, time) });
    const position = positionOf(agent);
    drawables.push({ depth: position[0] + position[1], draw: (c, time) => drawAgent(c, agent, position, time) });
  }
  drawables.sort((a, b) => a.depth - b.depth).forEach((d) => d.draw(ctx, t));
  for (const agent of agents) drawNameplate(ctx, agent, agent.id === selectedId);

  updateBubbles(agents);
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
    pose.arms = 'gesture';
  }
  const ring = agent.id === selectedId ? agent.color : status !== 'idle' ? STATUS_COLORS[status] : undefined;
  drawFigure(c, iso(position[0], position[1]), pose, agent.color, t, ring);
}

/** Ajuste la caméra pour que la salle tienne dans la fenêtre. */
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const minX = iso(0, ROOM.depth).x - 10;
  const maxX = iso(ROOM.width, 0).x + 10;
  const minY = iso(0, 0, ROOM.height).y - 10;
  const maxY = iso(ROOM.width, ROOM.depth).y + 24;
  // Marges fixes : la barre de dialogue flotte au-dessus de la scène sans la recadrer.
  const top = 52;
  const bottom = 24;
  const scale = Math.min((width - 24) / (maxX - minX), (height - top - bottom) / (maxY - minY), 2.4);
  camera = {
    scale,
    ox: (width - (maxX - minX) * scale) / 2 - minX * scale,
    oy: top + (height - top - bottom - (maxY - minY) * scale) / 2 - minY * scale,
  };
}

function toScreen(p: Point): Point {
  return { x: p.x * camera.scale + camera.ox, y: p.y * camera.scale + camera.oy };
}

// ---- Bulles ---------------------------------------------------------------------------------

function updateBubbles(agents: SceneAgent[]): void {
  const now = Date.now();
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const alive = new Set<string>();
  // De l'avant vers le fond : les bulles des agents les plus proches gardent leur place.
  const ordered = [...agents].sort((a, b) => positionOf(b)[0] + positionOf(b)[1] - (positionOf(a)[0] + positionOf(a)[1]));
  for (const agent of ordered) {
    const content = bubbleContent(agent, now);
    if (!content) continue;
    alive.add(agent.id);
    let el = bubbles.get(agent.id);
    if (!el) {
      el = document.createElement('div');
      el.innerHTML = '<div class="bubble-text"></div>';
      overlay.appendChild(el);
      bubbles.set(agent.id, el);
    }
    el.className = `bubble ${content.kind}`;
    el.style.setProperty('--status', STATUS_COLORS[agent.runtime.status]);
    const textEl = el.firstElementChild as HTMLDivElement;
    if (textEl.dataset.text !== content.text) {
      textEl.dataset.text = content.text;
      textEl.textContent = content.text;
    }

    const position = positionOf(agent);
    const head = toScreen(iso(position[0], position[1]));
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const rect = { left: head.x - width / 2, right: head.x + width / 2, bottom: head.y - FIGURE_HEIGHT * camera.scale - 8, top: 0 };
    rect.top = rect.bottom - height;
    // Remonte la bulle tant qu'elle chevauche une bulle déjà posée.
    for (let moved = true; moved; ) {
      moved = false;
      for (const other of placed) {
        if (rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top) {
          rect.bottom = other.top - 4;
          rect.top = rect.bottom - height;
          moved = true;
        }
      }
    }
    placed.push(rect);
    // Bulle décalée : la pointe ne désignerait plus le bon agent.
    el.classList.toggle('shifted', rect.bottom < head.y - FIGURE_HEIGHT * camera.scale - 8);
    el.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    el.style.zIndex = String(Math.round((position[0] + position[1]) * 10));
  }
  for (const [id, el] of bubbles) {
    if (alive.has(id)) continue;
    el.remove();
    bubbles.delete(id);
  }
}

function bubbleContent(agent: SceneAgent, now: number): { text: string; kind: string } | undefined {
  const { status, bubble } = agent.runtime;
  const fresh = bubble && now - bubble.at < BUBBLE_TTL_MS;
  if (status === 'thinking') {
    if (bubble?.kind === 'think' && fresh) return { text: bubble.text, kind: 'think' };
    return { text: '•••', kind: 'think dots' };
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

canvas.addEventListener('click', (event) => select(agentAt(event.clientX, event.clientY)?.id));
canvas.addEventListener('mousemove', (event) => {
  canvas.style.cursor = agentAt(event.clientX, event.clientY) ? 'pointer' : 'default';
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') select(undefined);
});
// Le dialogue expire même sans nouvel état.
setInterval(renderDialog, 2_000);

renderHeader();
requestAnimationFrame(frame);
