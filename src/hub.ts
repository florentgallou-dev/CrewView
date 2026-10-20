// Assemble définitions, configuration et session suivie en un état de scène diffusé aux vues.

import * as path from 'node:path';
import { claudeHome, projectTranscriptDir } from './claudePaths';
import { loadConfig } from './config';
import { discoverAgents } from './discovery';
import { placeAgents, type PlacedAgent } from './layout';
import { SessionWatcher } from './session';
import { SessionTracker } from './tracker';
import type { AgentRuntime, HostMessage, SceneState } from './types';

export interface HubOptions {
  root: string;
  claudeConfigDir?: string;
}

export type Sink = (message: HostMessage) => void;

const BROADCAST_THROTTLE_MS = 100;
const DEFINITIONS_CHECK_MS = 3_000;

export class CrewHub {
  readonly root: string;
  readonly transcriptDir: string;
  private placed: PlacedAgent[] = [];
  private placedSignature = '';
  private configError?: string;
  private tracker?: SessionTracker;
  private sessionId?: string;
  private watcher?: SessionWatcher;
  private readonly sinks = new Set<Sink>();
  private broadcastTimer?: NodeJS.Timeout;
  private definitionsTimer?: NodeJS.Timeout;

  constructor(options: HubOptions) {
    this.root = path.resolve(options.root);
    this.transcriptDir = projectTranscriptDir(this.root, claudeHome(options.claudeConfigDir));
  }

  start(): void {
    this.reloadDefinitions();
    this.watcher = new SessionWatcher(
      this.transcriptDir,
      () => this.createTracker(),
      (tracker, sessionId) => {
        this.tracker = tracker;
        this.sessionId = sessionId;
        this.scheduleBroadcast();
      },
    );
    this.watcher.start();
    this.definitionsTimer = setInterval(() => this.reloadDefinitions(), DEFINITIONS_CHECK_MS);
  }

  dispose(): void {
    this.watcher?.dispose();
    if (this.definitionsTimer) clearInterval(this.definitionsTimer);
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.sinks.clear();
  }

  subscribe(sink: Sink): () => void {
    this.sinks.add(sink);
    sink({ type: 'state', state: this.snapshot() });
    return () => this.sinks.delete(sink);
  }

  /** Chemin absolu du fichier de définition d'un agent. */
  sourceOf(agentId: string): string | undefined {
    const source = this.placed.find((a) => a.id === agentId)?.source;
    return source ? path.join(this.root, source) : undefined;
  }

  snapshot(): SceneState {
    const tracker = this.tracker;
    const agents = [...this.placed, ...(tracker?.temps ?? [])].map((agent) => ({
      ...agent,
      runtime: tracker?.runtimes.get(agent.id) ?? emptyRuntime(),
    }));
    return {
      project: path.basename(this.root),
      sessionId: this.sessionId,
      sessionTitle: tracker?.title,
      watching: Boolean(tracker),
      notice: this.configError ?? (tracker ? undefined : 'En attente d’une session Claude Code dans ce projet…'),
      agents,
      dialog: tracker?.dialog,
    };
  }

  private createTracker(): SessionTracker {
    return new SessionTracker(
      {
        mainId: () => this.placed.find((a) => a.isMain)?.id ?? 'main',
        has: (id) => this.placed.some((a) => a.id === id),
        nameOf: (id) => this.placed.find((a) => a.id === id)?.name,
      },
      {
        onChange: () => this.scheduleBroadcast(),
        onDelegate: (from, to, label) => {
          // L'état part d'abord : la vue doit connaître le destinataire (intérimaire tout juste arrivé).
          if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
          this.broadcastTimer = undefined;
          this.send({ type: 'state', state: this.snapshot() });
          this.send({ type: 'delegate', from, to, label });
        },
      },
    );
  }

  private reloadDefinitions(): void {
    const { config, error } = loadConfig(this.root);
    const placed = placeAgents(discoverAgents(this.root, config.agentsDirs), config);
    const signature = JSON.stringify([placed, error]);
    if (signature === this.placedSignature) return;
    this.placedSignature = signature;
    this.placed = placed;
    this.configError = error;
    this.scheduleBroadcast();
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
  return { status: 'idle', statusAt: 0, files: [], history: [], tokensIn: 0, tokensOut: 0, activeTasks: 0 };
}
