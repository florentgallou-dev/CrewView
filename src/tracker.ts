// Traduit les enregistrements des transcripts Claude Code en états d'agents.
// Session principale = agent principal (orchestrateur). Chaque appel de l'outil Agent
// ouvre une tâche confiée à un agent du projet, ou à un intérimaire si le type n'est pas défini.

import { normalizeId } from './discovery';
import { placeTemp, type PlacedAgent } from './layout';
import type { AgentRuntime, AgentStatus, BubbleKind, Dialog } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any -- les transcripts sont du JSON non typé */
type TranscriptRecord = any;

export interface AgentDirectory {
  mainId(): string;
  has(id: string): boolean;
  nameOf(id: string): string | undefined;
}

export interface TrackerEvents {
  onChange(): void;
  onDelegate(from: string, to: string, label: string): void;
}

export interface SubagentMeta {
  agentType?: string;
  toolUseId?: string;
  description?: string;
}

interface Task {
  agentId: string;
  active: boolean;
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const DONE_TO_IDLE_MS = 6_000;
const STALE_MS = 15 * 60_000;
const DORMANT_AFTER_REPLAY_MS = 90_000;
const HISTORY_SIZE = 40;
const FILES_SIZE = 12;

export class SessionTracker {
  readonly runtimes = new Map<string, AgentRuntime>();
  readonly temps: PlacedAgent[] = [];
  title?: string;
  dialog?: Dialog;
  /** Pendant la relecture initiale : pas d'animation de délégation. */
  replaying = false;

  private readonly tasks = new Map<string, Task>();
  private readonly subagentFiles = new Map<string, string>();
  private readonly toolNames = new Map<string, string>();
  private readonly usage = new Map<string, Map<string, { input: number; output: number }>>();

  constructor(
    private readonly directory: AgentDirectory,
    private readonly events: TrackerEvents,
  ) {}

  // ---- Entrées ----------------------------------------------------------------

  handleMain(record: TranscriptRecord): void {
    if (!record || record.isSidechain) return;
    const at = timeOf(record);
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
      this.title = record.aiTitle;
      this.events.onChange();
    } else if (record.type === 'user') {
      this.handleMainUser(record, at);
    } else if (record.type === 'assistant') {
      if (this.handleAssistant(this.main, record, at)) this.apply(this.main, at, 'done');
    }
  }

  registerSubagent(fileAgentId: string, meta: SubagentMeta): void {
    const toolUseId = meta.toolUseId ?? `file:${fileAgentId}`;
    this.subagentFiles.set(fileAgentId, toolUseId);
    if (!this.tasks.has(toolUseId)) {
      const agentId = this.resolveAgentType(meta.agentType ?? 'general-purpose');
      this.startTask(toolUseId, agentId, meta.description, Date.now());
    }
  }

  handleSubagent(fileAgentId: string, record: TranscriptRecord): void {
    const toolUseId = this.subagentFiles.get(fileAgentId);
    const task = toolUseId ? this.tasks.get(toolUseId) : undefined;
    if (!task || !record) return;
    const at = timeOf(record);
    if (record.type === 'assistant') {
      if (this.handleAssistant(task.agentId, record, at)) this.finishTask(toolUseId!, at);
    } else if (record.type === 'user' && hasToolResult(record.message?.content)) {
      this.setStatus(task.agentId, at, 'thinking');
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
      runtime = { status: 'idle', statusAt: 0, files: [], history: [], tokensIn: 0, tokensOut: 0, activeTasks: 0 };
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
      for (const block of content) if (block?.type === 'tool_result') this.handleToolResult(block.tool_use_id, record.toolUseResult, at);
    }
    const text = textOf(content);
    if (!text) return;

    const origin = record.origin?.kind;
    if (origin === 'task-notification' || text.startsWith('<task-notification>')) {
      const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1];
      if (toolUseId) this.finishTask(toolUseId, at);
      return;
    }
    if (record.isMeta || (origin && origin !== 'human')) return;
    if (text.startsWith('[Request interrupted')) {
      this.apply(this.main, at, 'idle', 'Interrompu', 'action');
      return;
    }
    const prompt = stripContextTags(text);
    if (!prompt) return;
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
  private handleAssistant(agentId: string, record: TranscriptRecord, at: number): boolean {
    const message = record.message;
    if (!message) return false;
    this.countUsage(agentId, message);
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
      if (!this.replaying) this.events.onDelegate(agentId, target, label);
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
        if (!this.replaying) this.events.onDelegate(agentId, task.agentId, 'Relance');
        return;
      }
    }

    const action = describeTool(name, input);
    if (action.file) {
      runtime.files = [action.file, ...runtime.files.filter((f) => f !== action.file)].slice(0, FILES_SIZE);
    }
    this.apply(agentId, at, action.status, action.text, action.status === 'asking' ? 'ask' : 'action');
  }

  // ---- Tâches déléguées ------------------------------------------------------------

  private startTask(toolUseId: string, agentId: string, label: string | undefined, at: number): void {
    if (this.tasks.has(toolUseId)) return;
    this.tasks.set(toolUseId, { agentId, active: true });
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
  }

  private resolveAgentType(type: string): string {
    const id = normalizeId(type);
    if (this.directory.has(id)) return id;
    const tempId = `interim-${id}`;
    if (!this.temps.some((t) => t.id === tempId)) this.temps.push(placeTemp(tempId, type, this.temps.length));
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

  /** Les blocs d'un même message partagent son id : on garde le dernier relevé d'usage. */
  private countUsage(agentId: string, message: TranscriptRecord): void {
    const usage = message.usage;
    if (!usage || !message.id) return;
    let perMessage = this.usage.get(agentId);
    if (!perMessage) this.usage.set(agentId, (perMessage = new Map()));
    perMessage.set(message.id, {
      input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      output: usage.output_tokens ?? 0,
    });
    const runtime = this.runtimeOf(agentId);
    runtime.tokensIn = 0;
    runtime.tokensOut = 0;
    for (const { input, output } of perMessage.values()) {
      runtime.tokensIn += input;
      runtime.tokensOut += output;
    }
  }
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

function timeOf(record: TranscriptRecord): number {
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
