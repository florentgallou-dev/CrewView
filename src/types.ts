// Types partagés entre l'hôte (extension / CLI) et la scène (webview / navigateur).

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'writing'
  | 'running'
  | 'delegating'
  | 'asking'
  | 'talking'
  | 'done';

export type Accessory = 'plant' | 'lamp' | 'mug' | 'books' | 'server' | 'magnifier' | 'trophy' | 'shield' | 'none';

export type BubbleKind = 'think' | 'say' | 'action' | 'ask';

export interface Bubble {
  text: string;
  kind: BubbleKind;
  at: number;
}

export interface HistoryEntry {
  at: number;
  status: AgentStatus;
  text: string;
}

export interface AgentRuntime {
  status: AgentStatus;
  statusAt: number;
  bubble?: Bubble;
  task?: string;
  tool?: string;
  files: string[];
  history: HistoryEntry[];
  tokensIn: number;
  tokensOut: number;
  activeTasks: number;
}

/** Poste de travail en coordonnées monde (tuiles). */
export interface Desk {
  x: number;
  y: number;
  w: number;
  d: number;
  kind: 'boss' | 'desk' | 'shared';
}

export interface SceneAgent {
  id: string;
  name: string;
  description: string;
  source?: string;
  color: string;
  accessory: Accessory;
  desk: Desk;
  /** Position debout de l'agent (derrière son bureau). */
  spot: [number, number];
  isMain: boolean;
  temp: boolean;
  runtime: AgentRuntime;
}

export interface Dialog {
  speaker: string;
  agentId?: string;
  text: string;
  at: number;
}

export interface SceneState {
  project: string;
  sessionId?: string;
  sessionTitle?: string;
  watching: boolean;
  notice?: string;
  agents: SceneAgent[];
  dialog?: Dialog;
}

export type HostMessage =
  | { type: 'state'; state: SceneState }
  | { type: 'delegate'; from: string; to: string; label: string };

export type ClientMessage = { type: 'ready' } | { type: 'openSource'; agentId: string };
