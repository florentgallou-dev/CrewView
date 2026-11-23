// Assemble définitions, configuration et session suivie en un état de scène diffusé aux vues.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { claudeHome, projectTranscriptDir } from './claudePaths';
import { loadConfig, type CrewConfig } from './config';
import { discoverAgents, type AgentDefinition } from './discovery';
import { applyTempLook, type DeskSlot, type OfficeLayout, placeAgents, placeTemp } from './layout';
import { SessionWatcher } from './session';
import { defaultThemeDir, readTheme, themeSignature, themeSources } from './theme';
import type { ThemeLayers } from './themeFiles';
import { SessionTracker } from './tracker';
import type { AgentRuntime, HostMessage, SceneState } from './types';
import { emptyUsage } from './usage';

export interface HubOptions {
  root: string;
  claudeConfigDir?: string;
  /** Dossier de thème commun à tous les projets (réglage crewView.themeDir). */
  themeDir?: string;
  /** Thème par défaut (tests ; sinon celui livré avec l'extension). */
  defaultThemeDir?: string;
  /** Journal de diagnostic (panneau Sortie « Crew View » dans VS Code, console pour la CLI). */
  log?: (line: string) => void;
}

export type Sink = (message: HostMessage) => void;

const BROADCAST_THROTTLE_MS = 100;
const DEFINITIONS_CHECK_MS = 3_000;
const THEME_CHECK_MS = 1_000;

export class CrewHub {
  readonly root: string;
  readonly transcriptDir: string;
  private layout: OfficeLayout = placeAgents([], {});
  private layoutSignature = '';
  private currentDefinitions: AgentDefinition[] = [];
  private currentConfig: CrewConfig = {};
  private currentConfigError?: string;
  private tracker?: SessionTracker;
  private sessionId?: string;
  private watcher?: SessionWatcher;
  private readonly sinks = new Set<Sink>();
  private broadcastTimer?: NodeJS.Timeout;
  private definitionsTimer?: NodeJS.Timeout;
  private themeTimer?: NodeJS.Timeout;
  private globalThemeDir?: string;
  private readonly baseThemeDir: string;
  private themeLayers: ThemeLayers = [];
  private currentThemeSignature?: string;
  private readonly log: (line: string) => void;

  constructor(options: HubOptions) {
    this.root = path.resolve(options.root);
    this.transcriptDir = projectTranscriptDir(this.root, claudeHome(options.claudeConfigDir));
    this.log = options.log ?? (() => undefined);
    this.globalThemeDir = options.themeDir;
    this.baseThemeDir = options.defaultThemeDir ?? defaultThemeDir();
  }

  start(): void {
    this.log(`Projet : ${this.root}`);
    this.log(`Transcripts surveillés : ${this.transcriptDir}${fs.existsSync(this.transcriptDir) ? '' : ' (pas encore créé)'}`);
    this.reloadDefinitions();
    this.reloadTheme();
    this.watcher = new SessionWatcher(
      this.transcriptDir,
      () => this.createTracker(),
      (tracker, sessionId) => {
        this.tracker = tracker;
        this.sessionId = sessionId;
        this.log(`Session suivie : ${sessionId} (${tracker.requests.length} demande(s) relue(s))`);
        this.scheduleBroadcast();
      },
    );
    this.watcher.start();
    this.definitionsTimer = setInterval(() => this.reloadDefinitions(), DEFINITIONS_CHECK_MS);
    this.themeTimer = setInterval(() => this.reloadTheme(), THEME_CHECK_MS);
  }

  dispose(): void {
    this.watcher?.dispose();
    if (this.definitionsTimer) clearInterval(this.definitionsTimer);
    if (this.themeTimer) clearInterval(this.themeTimer);
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.sinks.clear();
  }

  subscribe(sink: Sink): () => void {
    this.sinks.add(sink);
    sink({ type: 'state', state: this.snapshot() });
    sink({ type: 'theme', layers: this.themeLayers });
    return () => this.sinks.delete(sink);
  }

  /** Chemin absolu du fichier de définition d'un agent. */
  sourceOf(agentId: string): string | undefined {
    const source = this.layout.agents.find((a) => a.id === agentId)?.source;
    return source ? path.join(this.root, source) : undefined;
  }

  /** Configuration et définitions courantes (écran de paramètres). */
  get definitions(): AgentDefinition[] {
    return this.currentDefinitions;
  }

  get config(): CrewConfig {
    return this.currentConfig;
  }

  get configError(): string | undefined {
    return this.currentConfigError;
  }

  /** Postes de la grille actuelle. */
  get slots(): DeskSlot[] {
    return this.layout.slots;
  }

  /** Relit définitions et configuration immédiatement (après une modification par l'extension). */
  reload(): void {
    this.reloadDefinitions();
  }

  /** Thème graphique courant, couche du projet en tête. */
  get theme(): ThemeLayers {
    return this.themeLayers;
  }

  /** Change le dossier de thème global (réglage modifié). */
  setThemeDir(dir: string | undefined): void {
    this.globalThemeDir = dir;
    this.reloadTheme();
  }

  snapshot(): SceneState {
    const tracker = this.tracker;
    const temps = (tracker?.temps ?? []).flatMap((temp, index) => applyTempLook(placeTemp(temp.id, temp.name, index, this.layout.shared), this.currentConfig) ?? []);
    const agents = [...this.layout.agents, ...temps].map((agent) => ({
      ...agent,
      runtime: tracker?.runtimes.get(agent.id) ?? emptyRuntime(),
    }));
    return {
      project: path.basename(this.root),
      sessionId: this.sessionId,
      sessionTitle: tracker?.title,
      watching: Boolean(tracker),
      notice: this.currentConfigError ?? (tracker ? undefined : 'En attente d’une session Claude Code dans ce projet…'),
      agents,
      dialog: tracker?.dialog,
      requests: tracker?.requests ?? [],
      sessionCost: tracker?.sessionCost,
      context: tracker?.context,
      startedAt: tracker?.startedAt,
      lastActivityAt: tracker?.lastActivityAt,
      moves: tracker?.moves ?? [],
      room: this.layout.room,
    };
  }

  private createTracker(): SessionTracker {
    const nameOf = (id: string) => this.layout.agents.find((a) => a.id === id)?.name;
    return new SessionTracker(
      {
        mainId: () => this.layout.agents.find((a) => a.isMain)?.id ?? 'main',
        has: (id) => this.layout.agents.some((a) => a.id === id),
        nameOf,
        agentTypeOfFile: (fileAgentId) => this.agentTypeOfFile(fileAgentId),
      },
      {
        onChange: () => this.scheduleBroadcast(),
        onMove: (move) => {
          if (!this.tracker?.replaying) {
            this.log(`${move.kind === 'delegate' ? 'Délégation' : 'Rapport'} : ${nameOf(move.from) ?? move.from} → ${nameOf(move.to) ?? move.to}`);
          }
          // Les déplacements partent sans attendre : la vue doit les jouer au plus tôt.
          if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
          this.broadcastTimer = undefined;
          this.send({ type: 'state', state: this.snapshot() });
        },
      },
    );
  }

  /** Type d'un subagent lancé dans une autre session du projet (fichier `<session>/subagents/agent-<id>.meta.json`). */
  private agentTypeOfFile(fileAgentId: string): string | undefined {
    let sessions: string[];
    try {
      sessions = fs.readdirSync(this.transcriptDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return undefined;
    }
    for (const session of sessions) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(this.transcriptDir, session, 'subagents', `agent-${fileAgentId}.meta.json`), 'utf8'));
        if (typeof meta.agentType === 'string') return meta.agentType;
      } catch {
        // Pas dans cette session.
      }
    }
    this.log(`Relance d'un agent introuvable (${fileAgentId}) : pas de déplacement`);
    return undefined;
  }

  private reloadDefinitions(): void {
    const { config, error } = loadConfig(this.root);
    const definitions = discoverAgents(this.root, config.agentsDirs);
    const layout = placeAgents(definitions, config);
    const signature = JSON.stringify([layout, error, config, definitions.map((d) => [d.id, d.name])]);
    if (signature === this.layoutSignature) return;
    if (this.layoutSignature) this.log(`Agents rechargés : ${layout.agents.map((a) => a.id).join(', ')}`);
    else this.log(`Agents : ${layout.agents.map((a) => (a.isMain ? `${a.id} (principal)` : a.id)).join(', ')}`);
    if (error) this.log(`Configuration : ${error}`);
    this.layoutSignature = signature;
    this.layout = layout;
    this.currentDefinitions = definitions;
    this.currentConfig = config;
    this.currentConfigError = error;
    this.scheduleBroadcast();
  }

  private reloadTheme(): void {
    const sources = themeSources(this.root, this.globalThemeDir, this.baseThemeDir);
    const signature = themeSignature(sources);
    if (signature === this.currentThemeSignature) return;
    const first = this.currentThemeSignature === undefined;
    this.currentThemeSignature = signature;
    this.themeLayers = readTheme(sources);
    const counts = sources.map((source, i) => `${Object.keys(this.themeLayers[i]).length} (${source.label})`).join(', ');
    this.log(`${first ? 'Thème' : 'Thème rechargé'} : ${counts} fichier(s)`);
    if (Object.keys(this.themeLayers[this.themeLayers.length - 1]).length === 0) this.log(`Thème par défaut introuvable : ${this.baseThemeDir}`);
    if (!first) this.send({ type: 'theme', layers: this.themeLayers });
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = undefined;
      this.send({ type: 'state', state: this.snapshot() });
    }, BROADCAST_THROTTLE_MS);
  }

  private send(message: HostMessage): void {
    for (const sink of this.sinks) sink(message);
  }
}

function emptyRuntime(): AgentRuntime {
  return { status: 'idle', statusAt: 0, files: [], history: [], usage: emptyUsage(), activeTasks: 0 };
}
