// Traduit les enregistrements des transcripts Claude Code en états d'agents.
// Session principale = agent principal (orchestrateur). Chaque appel de l'outil Agent
// ouvre une tâche confiée à un agent du projet ou de la configuration globale (personnel, plugin),
// ou à un intérimaire si le type n'est défini nulle part.

import { normalizeId } from './discovery';
import type { AgentRuntime, AgentStatus, BubbleKind, ContextUsage, Dialog, Move, RequestSummary, SessionCost, TokenUsage } from './types';
import { addUsage, emptyUsage, usageOfMessage } from './usage';

/* eslint-disable @typescript-eslint/no-explicit-any -- les transcripts sont du JSON non typé */
type TranscriptRecord = any;

export interface AgentDirectory {
  mainId(): string;
  has(id: string): boolean;
  /** Agent désigné par un identifiant de type, alias compris (nom court d'un agent de plugin). */
  resolve?(id: string): string | undefined;
  nameOf(id: string): string | undefined;
  /** Type d'un subagent d'une autre session (relance d'un agent lancé avant une interruption). */
  agentTypeOfFile?(fileAgentId: string): string | undefined;
}

export interface TrackerEvents {
  onChange(): void;
  /** Nouveau déplacement : délégation, relance ou rapport à l'agent principal. */
  onMove(move: Move): void;
}

export interface SubagentMeta {
  agentType?: string;
  toolUseId?: string;
  description?: string;
}

interface Task {
  agentId: string;
  active: boolean;
  /** Demande pendant laquelle la tâche a été confiée : sa consommation lui est imputée. */
  requestId: string;
  /** Rapports déjà rendus (une tâche relancée en rend un nouveau à chaque fin). */
  reports: number;
}

interface CountedMessage {
  agentId: string;
  requestId: string;
  usage: TokenUsage;
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const DONE_TO_IDLE_MS = 6_000;
const STALE_MS = 15 * 60_000;
/** Commande en arrière-plan sans notification de fin : abandonnée après 3 h sans activité dans la session. */
const BACKGROUND_STALE_MS = 3 * 3_600_000;
/** Outils qui arrêtent une tâche en arrière-plan (identifiant dans task_id ou shell_id). */
const STOP_TOOLS = new Set(['TaskStop', 'KillShell', 'KillBash']);
const DORMANT_AFTER_REPLAY_MS = 90_000;
const HISTORY_SIZE = 40;
const FILES_SIZE = 12;
const MOVES_SIZE = 40;
/** Notifications retenues pour ignorer leurs doublons : les plus récentes suffisent. */
const NOTIFICATIONS_SIZE = 100;

export class SessionTracker {
  readonly runtimes = new Map<string, AgentRuntime>();
  /** Intérimaires (agents intégrés non définis dans le projet), dans leur ordre d'arrivée. */
  readonly temps: { id: string; name: string }[] = [];
  title?: string;
  dialog?: Dialog;
  /** Demandes de la session, dans l'ordre chronologique. */
  readonly requests: RequestSummary[] = [];
  sessionCost?: SessionCost;
  /** Remplissage du contexte de la session principale (dernière réponse du modèle). */
  context?: ContextUsage;
  /** Premier et dernier échange daté de la session (prompts et réponses, sous-agents compris). */
  startedAt?: number;
  lastActivityAt?: number;
  /** Derniers déplacements ; la scène joue ceux qu'elle n'a pas encore montrés. */
  readonly moves: Move[] = [];
  /**
   * Pendant la relecture d'une session, les mouvements gardent l'heure du transcript (la scène ignore
   * les anciens) ; en direct, ils prennent l'heure de lecture, même si le fichier a été écrit en retard.
   */
  replaying = false;

  private readonly tasks = new Map<string, Task>();
  private readonly subagentFiles = new Map<string, string>();
  private readonly toolNames = new Map<string, string>();
  /** Notifications déjà traitées : la même est écrite en enqueue, remove et attachment. */
  private readonly notifications = new Set<string>();
  /** Une réponse du modèle est découpée en plusieurs enregistrements portant le même id : on garde le dernier relevé. */
  private readonly counted = new Map<string, CountedMessage>();

  constructor(
    private readonly directory: AgentDirectory,
    private readonly events: TrackerEvents,
  ) {}

  // ---- Entrées ----------------------------------------------------------------

  handleMain(record: TranscriptRecord): void {
    if (!record || record.isSidechain) return;
    const at = timeOf(record);
    this.markActivity(record);
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
      this.title = record.aiTitle;
      this.events.onChange();
    } else if (record.type === 'queue-operation' && typeof record.content === 'string') {
      // Notification mise en file : parfois la seule trace de la fin d'une tâche déléguée ou d'une commande tuée.
      const text = record.content.trim();
      if (text.startsWith('<task-notification>')) this.notified(text, at);
    } else if (record.type === 'attachment' && record.attachment?.type === 'queued_command') {
      const text = textOf(record.attachment.prompt);
      if (text.startsWith('<task-notification>')) this.notified(text, at);
    } else if (record.type === 'cost-state') {
      this.sessionCost = sessionCostOf(record);
      this.events.onChange();
    } else if (record.type === 'user') {
      this.handleMainUser(record, at);
    } else if (record.type === 'assistant') {
      this.context = contextOf(record.message) ?? this.context;
      if (this.handleAssistant(this.main, record, at, this.currentRequest(at).id)) this.apply(this.main, at, 'done');
    }
  }

  registerSubagent(fileAgentId: string, meta: SubagentMeta, at = Date.now()): void {
    const toolUseId = meta.toolUseId ?? `file:${fileAgentId}`;
    this.subagentFiles.set(fileAgentId, toolUseId);
    if (!this.tasks.has(toolUseId)) {
      const agentId = this.resolveAgentType(meta.agentType ?? 'general-purpose');
      this.startTask(toolUseId, agentId, meta.description, at);
    }
  }

  handleSubagent(fileAgentId: string, record: TranscriptRecord): void {
    const toolUseId = this.subagentFiles.get(fileAgentId);
    const task = toolUseId ? this.tasks.get(toolUseId) : undefined;
    if (!task || !record) return;
    const at = timeOf(record);
    this.markActivity(record);
    if (record.type === 'assistant') {
      const wasActive = task.active;
      const ended = this.handleAssistant(task.agentId, record, at, task.requestId);
      // Rapport rendu par l'outil SubagentHandback : fin de la tâche, sans fin de tour.
      if (ended || hasToolUse(record.message?.content, 'SubagentHandback')) {
        // Notification lue avant le rapport : la tâche est déjà close, l'agent redevient « terminé ».
        if (!wasActive && this.runtimeOf(task.agentId).activeTasks === 0) this.setStatus(task.agentId, at, 'done');
        else this.finishTask(toolUseId!, at);
      }
    } else if (record.type === 'user') {
      const content = record.message?.content;
      if (Array.isArray(content)) for (const block of content) if (block?.type === 'tool_result') this.noteBackgroundResult(block, record.toolUseResult);
      const text = textOf(content);
      if (text.startsWith('<task-notification>')) this.endNotified(text);
      // Une tâche close ne revit pas sur un résultat tardif (accusé de réception du rapport).
      if (hasToolResult(content) && task.active) this.setStatus(task.agentId, at, 'thinking');
    }
  }

  /** Fait évoluer les statuts avec le temps (fin d'animation « terminé », sessions abandonnées). */
  sweep(now: number): void {
    let changed = false;
    for (const runtime of this.runtimes.values()) {
      const age = now - runtime.statusAt;
      const expired =
        (runtime.status === 'done' && age > DONE_TO_IDLE_MS) ||
        (runtime.status !== 'idle' && runtime.status !== 'asking' && age > STALE_MS);
      if (expired) {
        runtime.status = 'idle';
        changed = true;
      }
      if (runtime.background.length && this.lastActivityAt !== undefined && now - this.lastActivityAt > BACKGROUND_STALE_MS) {
        runtime.background = [];
        changed = true;
      }
    }
    if (changed) this.events.onChange();
  }

  /** Après la relecture d'une session : tout ce qui n'a pas bougé récemment est au repos. */
  settle(now: number): void {
    for (const [id, runtime] of this.runtimes) {
      if (now - runtime.statusAt <= DORMANT_AFTER_REPLAY_MS) continue;
      runtime.status = 'idle';
      runtime.activeTasks = 0;
      for (const task of this.tasks.values()) if (task.agentId === id) task.active = false;
    }
    this.events.onChange();
  }

  runtimeOf(id: string): AgentRuntime {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = { status: 'idle', statusAt: 0, files: [], history: [], usage: emptyUsage(), activeTasks: 0, background: [] };
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  // ---- Session principale ----------------------------------------------------------

  private get main(): string {
    return this.directory.mainId();
  }

  private handleMainUser(record: TranscriptRecord, at: number): void {
    const content = record.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_result') continue;
        this.noteBackgroundResult(block, record.toolUseResult);
        this.handleToolResult(block.tool_use_id, record.toolUseResult, at);
      }
    }
    const text = textOf(content);
    if (!text) return;

    const origin = record.origin?.kind;
    if (origin === 'task-notification' || text.startsWith('<task-notification>')) {
      this.notified(text, at);
      return;
    }
    if (record.isMeta || (origin && origin !== 'human')) return;
    if (text.startsWith('[Request interrupted')) {
      this.apply(this.main, at, 'idle', 'Interrompu', 'action');
      return;
    }
    const prompt = stripContextTags(text);
    if (!prompt) return;
    this.requests.push({ id: record.promptId ?? record.uuid ?? `demande-${this.requests.length + 1}`, at, prompt: clip(prompt, 140), total: emptyUsage(), byAgent: {} });
    this.dialog = { speaker: 'Vous', text: clip(prompt, 400), at };
    this.apply(this.main, at, 'thinking', 'Lit votre demande…', 'think');
  }

  private handleToolResult(toolUseId: string, result: TranscriptRecord, at: number): void {
    const name = this.toolNames.get(toolUseId);
    const async = result && typeof result === 'object' && (result.isAsync || result.status === 'async_launched');
    if (name && AGENT_TOOLS.has(name) && !async) this.finishTask(toolUseId, at);
    const runtime = this.runtimeOf(this.main);
    if (runtime.status !== 'idle' && runtime.status !== 'done') this.setStatus(this.main, at, 'thinking');
  }

  // ---- Messages de l'assistant (principal ou subagent) -------------------------------------

  /** Retourne vrai si le message clôt le tour de l'agent. */
  private handleAssistant(agentId: string, record: TranscriptRecord, at: number, requestId: string): boolean {
    const message = record.message;
    if (!message) return false;
    this.countUsage(agentId, requestId, message);
    this.noteEngine(agentId, record);
    const content: TranscriptRecord[] = Array.isArray(message.content) ? message.content : [];

    for (const block of content) {
      if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
        const thought = typeof block.thinking === 'string' ? block.thinking.trim() : '';
        if (thought) this.apply(agentId, at, 'thinking', thought, 'think');
        else this.setStatus(agentId, at, 'thinking');
      } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        this.apply(agentId, at, 'talking', block.text.trim(), 'say');
        if (agentId === this.main) this.dialog = { speaker: this.directory.nameOf(agentId) ?? 'Claude', agentId, text: clip(block.text.trim(), 400), at };
      } else if (block?.type === 'tool_use') {
        this.handleToolUse(agentId, block, at);
      }
    }
    return message.stop_reason === 'end_turn' && !content.some((b) => b?.type === 'tool_use');
  }

  /** Modèle et effort de la réponse ; un message synthétique (erreur d'API, interruption) ne les change pas. */
  private noteEngine(agentId: string, record: TranscriptRecord): void {
    const model = record.message?.model;
    if (typeof model !== 'string' || !model || model === '<synthetic>') return;
    const runtime = this.runtimeOf(agentId);
    runtime.model = model;
    runtime.effort = typeof record.effort === 'string' && record.effort ? record.effort : undefined;
  }

  private handleToolUse(agentId: string, block: TranscriptRecord, at: number): void {
    const name: string = block.name ?? '';
    const input = block.input ?? {};
    if (agentId === this.main) this.toolNames.set(block.id, name);
    const runtime = this.runtimeOf(agentId);
    runtime.tool = name;

    if (AGENT_TOOLS.has(name)) {
      const target = this.resolveAgentType(input.subagent_type || 'general-purpose');
      const label: string = input.description || 'Nouvelle tâche';
      this.apply(agentId, at, 'delegating', `Délègue à ${this.nameOf(target)} : ${label}`, 'say');
      this.startTask(block.id, target, label, at);
      this.move(`d:${block.id}`, 'delegate', agentId, target, at);
      return;
    }
    if (name === 'SendMessage' && typeof input.to === 'string') {
      const toolUseId = this.subagentFiles.get(input.to);
      const task = toolUseId ? this.tasks.get(toolUseId) : undefined;
      if (task) {
        this.apply(agentId, at, 'delegating', `Relance ${this.nameOf(task.agentId)}`, 'say');
        if (!task.active) {
          task.active = true;
          this.runtimeOf(task.agentId).activeTasks++;
        }
        this.apply(task.agentId, at, 'thinking', 'Reprend sa tâche', 'think');
        this.move(`s:${block.id}`, 'delegate', agentId, task.agentId, at);
        return;
      }
      // Agent lancé dans une autre session (avant une interruption) : retrouvé par son type.
      const type = this.directory.agentTypeOfFile?.(input.to);
      if (type) {
        const target = this.resolveAgentType(type);
        this.apply(agentId, at, 'delegating', `Relance ${this.nameOf(target)}`, 'say');
        this.apply(target, at, 'thinking', 'Reprend sa tâche', 'think');
        this.move(`s:${block.id}`, 'delegate', agentId, target, at);
        return;
      }
    }

    if (input.run_in_background === true) {
      const label = typeof input.description === 'string' && input.description ? input.description : clip(String(input.command ?? name), 80);
      runtime.background = [...runtime.background.filter((b) => b.toolUseId !== block.id), { toolUseId: block.id, label, since: at }];
    }
    if (STOP_TOOLS.has(name)) this.endBackground([], [String(input.task_id ?? input.shell_id ?? input.bash_id ?? '')]);

    const action = describeTool(name, input);
    if (action.file) {
      runtime.files = [action.file, ...runtime.files.filter((f) => f !== action.file)].slice(0, FILES_SIZE);
    }
    this.apply(agentId, at, action.status, action.text, action.status === 'asking' ? 'ask' : 'action');
  }

  // ---- Commandes en arrière-plan ------------------------------------------------------

  /** Réponse au lancement : identifiant de tâche, ou échec (la commande n'a pas démarré). */
  private noteBackgroundResult(block: TranscriptRecord, result: TranscriptRecord): void {
    for (const runtime of this.runtimes.values()) {
      const task = runtime.background.find((b) => b.toolUseId === block.tool_use_id);
      if (!task) continue;
      if (block.is_error) {
        runtime.background = runtime.background.filter((b) => b !== task);
        return;
      }
      const fromResult = result && typeof result === 'object' ? result.backgroundTaskId : undefined;
      task.taskId = typeof fromResult === 'string' ? fromResult : /with ID: ([\w-]+)/.exec(textOf(block.content))?.[1];
      return;
    }
  }

  /** Notification de tâche : clôt les tâches déléguées et les commandes citées. */
  private notified(text: string, at: number): void {
    if (this.notifications.has(text)) return;
    this.notifications.add(text);
    if (this.notifications.size > NOTIFICATIONS_SIZE) this.notifications.delete(this.notifications.values().next().value!);
    if (this.endNotified(text)) this.events.onChange();
    for (const m of text.matchAll(/<tool-use-id>([^<]+)<\/tool-use-id>/g)) this.finishTask(m[1], at);
  }

  /** Notification de tâche : termine chaque commande citée (une notification peut en citer plusieurs). */
  private endNotified(text: string): boolean {
    const toolUseIds = [...text.matchAll(/<tool-use-id>([^<]+)<\/tool-use-id>/g)].map((m) => m[1]);
    const taskIds = [...text.matchAll(/<task-id>([^<]+)<\/task-id>/g)].map((m) => m[1]);
    return this.endBackground(toolUseIds, taskIds);
  }

  private endBackground(toolUseIds: string[], taskIds: string[]): boolean {
    let changed = false;
    for (const runtime of this.runtimes.values()) {
      const kept = runtime.background.filter((b) => !toolUseIds.includes(b.toolUseId) && !(b.taskId && taskIds.includes(b.taskId)));
      if (kept.length !== runtime.background.length) {
        runtime.background = kept;
        changed = true;
      }
    }
    return changed;
  }

  // ---- Tâches déléguées ------------------------------------------------------------

  private startTask(toolUseId: string, agentId: string, label: string | undefined, at: number): void {
    if (this.tasks.has(toolUseId)) return;
    this.tasks.set(toolUseId, { agentId, active: true, requestId: this.currentRequest(at).id, reports: 0 });
    const runtime = this.runtimeOf(agentId);
    runtime.activeTasks++;
    runtime.task = label;
    this.apply(agentId, at, 'thinking', label ? `Reçoit : ${label}` : 'Reçoit une tâche', 'think');
  }

  private finishTask(toolUseId: string, at: number): void {
    const task = this.tasks.get(toolUseId);
    if (!task?.active) return;
    task.active = false;
    const runtime = this.runtimeOf(task.agentId);
    runtime.activeTasks = Math.max(0, runtime.activeTasks - 1);
    if (runtime.activeTasks === 0) this.apply(task.agentId, at, 'done', 'Tâche terminée', 'action');
    if (task.agentId !== this.main) this.move(`r:${toolUseId}:${++task.reports}`, 'report', task.agentId, this.main, at);
  }

  /** Enregistre un déplacement (une seule fois par identifiant). */
  private move(id: string, kind: Move['kind'], from: string, to: string, recordAt: number): void {
    if (from === to || this.moves.some((m) => m.id === id)) return;
    const move: Move = { id, kind, from, to, at: this.replaying ? recordAt : Date.now() };
    this.moves.push(move);
    if (this.moves.length > MOVES_SIZE) this.moves.splice(0, this.moves.length - MOVES_SIZE);
    this.events.onMove(move);
  }

  private resolveAgentType(type: string): string {
    const id = normalizeId(type);
    const known = this.directory.resolve ? this.directory.resolve(id) : this.directory.has(id) ? id : undefined;
    if (known) return known;
    const tempId = `interim-${id}`;
    if (!this.temps.some((t) => t.id === tempId)) this.temps.push({ id: tempId, name: type });
    return tempId;
  }

  private nameOf(id: string): string {
    return this.directory.nameOf(id) ?? this.temps.find((t) => t.id === id)?.name ?? id;
  }

  // ---- Mise à jour des états ---------------------------------------------------------

  private apply(agentId: string, at: number, status: AgentStatus, text?: string, kind: BubbleKind = 'action'): void {
    const runtime = this.runtimeOf(agentId);
    runtime.status = status;
    runtime.statusAt = at;
    if (text) {
      runtime.bubble = { text: clip(text, 240), kind, at };
      runtime.history.push({ at, status, text: clip(text, 160) });
      if (runtime.history.length > HISTORY_SIZE) runtime.history.splice(0, runtime.history.length - HISTORY_SIZE);
    }
    this.events.onChange();
  }

  private setStatus(agentId: string, at: number, status: AgentStatus): void {
    const runtime = this.runtimeOf(agentId);
    runtime.status = status;
    runtime.statusAt = at;
    this.events.onChange();
  }

  /** Durée de la session : seuls les prompts et les réponses datés comptent (pas les métadonnées). */
  private markActivity(record: TranscriptRecord): void {
    if (record.type !== 'user' && record.type !== 'assistant') return;
    const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    if (!Number.isFinite(at)) return;
    if (this.startedAt === undefined || at < this.startedAt) this.startedAt = at;
    if (this.lastActivityAt === undefined || at > this.lastActivityAt) this.lastActivityAt = at;
  }

  // ---- Consommation ---------------------------------------------------------------------

  /** Demande en cours ; avant tout prompt (session reprise), une demande « début de session » la remplace. */
  private currentRequest(at: number): RequestSummary {
    if (!this.requests.length) this.requests.push({ id: 'debut', at, prompt: '(début de session)', total: emptyUsage(), byAgent: {} });
    return this.requests[this.requests.length - 1];
  }

  /** Impute la consommation d'une réponse à l'agent, à la demande et au bilan par agent de la demande. */
  private countUsage(agentId: string, requestId: string, message: TranscriptRecord): void {
    const usage = usageOfMessage(message);
    if (!usage || !message.id) return;
    const previous = this.counted.get(message.id);
    if (previous) this.account(previous, -1);
    const counted = { agentId, requestId, usage };
    this.counted.set(message.id, counted);
    this.account(counted, 1);
  }

  private account({ agentId, requestId, usage }: CountedMessage, sign: 1 | -1): void {
    addUsage(this.runtimeOf(agentId).usage, usage, sign);
    const request = this.requests.find((r) => r.id === requestId);
    if (!request) return;
    addUsage(request.total, usage, sign);
    addUsage((request.byAgent[agentId] ??= emptyUsage()), usage, sign);
  }
}

/** Contexte envoyé au modèle pour une réponse : le calcul de l'indicateur de Claude Code. */
function contextOf(message: TranscriptRecord): ContextUsage | undefined {
  const usage = usageOfMessage(message);
  const tokens = usage ? usage.input + usage.cacheWrite + usage.cacheRead : 0;
  if (!usage || tokens === 0 || typeof message?.model !== 'string') return undefined;
  return { tokens, model: message.model };
}

/** Coût réel cumulé de la session, tel que Claude Code l'enregistre. */
function sessionCostOf(record: TranscriptRecord): SessionCost {
  const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const byModel = Object.entries((record.modelUsage ?? {}) as Record<string, TranscriptRecord>).map(([model, u]) => ({
    model,
    costUsd: n(u?.costUSD),
    inputTokens: n(u?.inputTokens),
    outputTokens: n(u?.outputTokens),
    cacheReadTokens: n(u?.cacheReadInputTokens),
    cacheWriteTokens: n(u?.cacheCreationInputTokens),
    webSearches: n(u?.webSearchRequests),
  }));
  return { totalUsd: n(record.totalCostUSD), byModel };
}

// ---- Description des outils ------------------------------------------------------------

interface ToolAction {
  status: AgentStatus;
  text: string;
  file?: string;
}

export function describeTool(name: string, input: Record<string, any>): ToolAction {
  const file = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).pop() ?? p : '');
  switch (name) {
    case 'Read':
      return { status: 'reading', text: `Lit ${file(input.file_path)}`, file: input.file_path };
    case 'Grep':
      return { status: 'reading', text: `Cherche « ${clip(String(input.pattern ?? ''), 40)} »` };
    case 'Glob':
    case 'LS':
      return { status: 'reading', text: `Parcourt ${clip(String(input.pattern ?? input.path ?? ''), 50)}` };
    case 'WebFetch':
      return { status: 'reading', text: `Consulte ${hostOf(input.url)}` };
    case 'WebSearch':
      return { status: 'reading', text: `Recherche « ${clip(String(input.query ?? ''), 50)} »` };
    case 'Edit':
    case 'MultiEdit':
      return { status: 'writing', text: `Modifie ${file(input.file_path)}`, file: input.file_path };
    case 'Write':
      return { status: 'writing', text: `Écrit ${file(input.file_path)}`, file: input.file_path };
    case 'NotebookEdit':
      return { status: 'writing', text: `Modifie ${file(input.notebook_path)}`, file: input.notebook_path };
    case 'Bash':
    case 'PowerShell':
      return { status: 'running', text: input.description ? String(input.description) : `$ ${clip(String(input.command ?? ''), 60)}` };
    case 'BashOutput':
    case 'Monitor':
    case 'TaskOutput':
      return { status: 'running', text: 'Surveille une commande' };
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return { status: 'thinking', text: 'Organise ses tâches' };
    case 'AskUserQuestion':
      return { status: 'asking', text: input.questions?.[0]?.question ?? 'Vous pose une question' };
    case 'ExitPlanMode':
      return { status: 'asking', text: 'Vous soumet un plan' };
    case 'SubagentHandback':
      return { status: 'talking', text: 'Rend son rapport' };
    case 'Skill':
      return { status: 'thinking', text: `Consulte la compétence ${input.skill ?? ''}`.trim() };
    case 'ToolSearch':
      return { status: 'thinking', text: 'Cherche un outil' };
    default:
      if (name.startsWith('mcp__')) {
        const [, server, ...tool] = name.split('__');
        return { status: 'running', text: `Outil ${server} · ${tool.join('__')}` };
      }
      return { status: 'running', text: `Utilise ${name}` };
  }
}

// ---- Utilitaires -------------------------------------------------------------------------

export function timeOf(record: TranscriptRecord): number {
  const parsed = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function hasToolUse(content: unknown, name: string): boolean {
  return Array.isArray(content) && content.some((b) => b?.type === 'tool_use' && b.name === name);
}

function hasToolResult(content: unknown): boolean {
  return Array.isArray(content) && content.some((b) => b?.type === 'tool_result');
}

/** Retire le contexte injecté par l'IDE ou le harnais pour ne garder que la demande tapée. */
function stripContextTags(text: string): string {
  return text
    .replace(/<(ide_[a-z_]+|system-reminder|command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g, '')
    .trim();
}

function hostOf(url: unknown): string {
  try {
    return new URL(String(url)).host;
  } catch {
    return 'une page web';
  }
}

/** Texte sur une ligne, sans balisage markdown, tronqué à `max` caractères. */
export function clip(text: string, max: number): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
