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

/**
 * Consommation relevée dans les champs `usage` des réponses du modèle (chiffres réels),
 * plus un coût estimé à partir des tarifs publics (seule valeur calculée).
 */
export interface TokenUsage {
  /** Réponses distinctes du modèle. */
  calls: number;
  input: number;
  /** Total écrit dans le cache (`cache_creation_input_tokens`). */
  cacheWrite: number;
  /** Détail par durée, quand le transcript le fournit. */
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  /** Part de la sortie consacrée à la réflexion (`output_tokens_details.thinking_tokens`). */
  thinking: number;
  webSearches: number;
  webFetches: number;
  /** Appels par modèle. */
  models: Record<string, number>;
  /** Coût estimé en dollars (tarifs API publics). */
  costUsd: number;
  /** Appels exclus de l'estimation faute de tarif connu pour leur modèle. */
  unpricedCalls: number;
}

/** Bilan d'une demande : du prompt de l'utilisateur jusqu'au suivant, subagents compris. */
export interface RequestSummary {
  id: string;
  at: number;
  prompt: string;
  total: TokenUsage;
  byAgent: Record<string, TokenUsage>;
}

/** Coût réel enregistré par Claude Code pour la session (enregistrement `cost-state`). */
export interface SessionCost {
  totalUsd: number;
  byModel: { model: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; webSearches: number }[];
}

export interface AgentRuntime {
  status: AgentStatus;
  statusAt: number;
  bubble?: Bubble;
  task?: string;
  tool?: string;
  files: string[];
  history: HistoryEntry[];
  /** Consommation de l'agent sur la session suivie. */
  usage: TokenUsage;
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
  /** Demandes de la session suivie, dans l'ordre chronologique. */
  requests: RequestSummary[];
  sessionCost?: SessionCost;
}

// ---- Écran de paramètres (barre latérale) ----------------------------------------------------

export interface SettingsAgent {
  id: string;
  name: string;
  /** Nom de la définition, affiché quand aucun nom personnalisé n'est saisi. */
  defaultName: string;
  label?: string;
  color: string;
  accessory: Accessory;
  hidden: boolean;
  isMain: boolean;
  temp: boolean;
  /** Index dans `slots`, ou -1 pour une position personnalisée. */
  slot: number;
  desk?: [number, number];
}

export interface SettingsData {
  project: string;
  configExists: boolean;
  configError?: string;
  orchestrator?: string;
  agentsDirs: string[];
  definitions: { id: string; name: string }[];
  agents: SettingsAgent[];
  slots: { label: string; x: number; y: number }[];
  accessories: Accessory[];
  port: number;
  claudeConfigDir: string;
}

export interface AgentPatch {
  label?: string;
  color?: string;
  accessory?: Accessory;
  hidden?: boolean;
  slot?: number;
}

export interface ProjectPatch {
  orchestrator?: string;
  agentsDirs?: string[];
}

export type CrewCommand = 'crewView.open' | 'crewView.openInBrowser' | 'crewView.generateClaudeAgents' | 'crewView.initConfig';

// ---- Messages ---------------------------------------------------------------------------------

export type HostMessage =
  | { type: 'state'; state: SceneState }
  | { type: 'delegate'; from: string; to: string; label: string }
  | { type: 'selection'; agentId?: string }
  | { type: 'settings'; data: SettingsData }
  | { type: 'ui'; folds: Record<string, boolean> };

export type ClientMessage =
  | { type: 'ready' }
  | { type: 'openSource'; agentId: string }
  | { type: 'select'; agentId?: string }
  | { type: 'command'; command: CrewCommand }
  | { type: 'updateAgent'; id: string; patch: AgentPatch }
  | { type: 'updateProject'; patch: ProjectPatch }
  | { type: 'updateSetting'; key: 'port' | 'claudeConfigDir'; value: string | number }
  /** Sections repliées/dépliées de la fiche agent, mémorisées par l'extension. */
  | { type: 'ui'; folds: Record<string, boolean> };
