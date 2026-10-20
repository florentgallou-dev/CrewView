// Barre latérale « Crew » : liste des agents, agent sélectionné, demandes et paramètres.
// Les vues partagent un abonnement au hub du projet courant.

import * as vscode from 'vscode';
import { createNonce, renderSidebarPage, type SidebarView } from './html';
import type { CrewHub } from './hub';
import { applyAgentPatch, applyProjectPatch, buildSettings } from './settings';
import type { ClientMessage, HostMessage, SceneState } from './types';

export const VIEW_IDS: Record<SidebarView, string> = {
  agents: 'crewView.agents',
  agent: 'crewView.agent',
  requests: 'crewView.requests',
  settings: 'crewView.settings',
};

/** Vues qui affichent l'état de la scène (les paramètres ont leurs propres données). */
const STATE_VIEWS = ['agents', 'agent', 'requests'] as const;
const FOLDS_KEY = 'crewView.folds';

export interface SidebarHost {
  /** Projet affiché par la barre latérale. */
  currentRoot(): string | undefined;
  acquireHub(root: string): CrewHub;
  releaseHub(root: string): void;
  selected(root: string): string | undefined;
  select(root: string, agentId: string | undefined): void;
  openSource(root: string, agentId: string): void;
}

export class CrewSidebar {
  private readonly views = new Map<SidebarView, vscode.WebviewView>();
  private root?: string;
  private hub?: CrewHub;
  private unsubscribe?: () => void;
  private state?: SceneState;
  private settingsSignature = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: SidebarHost,
    /** Mémoire globale de VS Code : sections repliées, conservées d'une session à l'autre. */
    private readonly memento: vscode.Memento,
  ) {}

  register(): vscode.Disposable[] {
    return (Object.keys(VIEW_IDS) as SidebarView[]).map((view) =>
      vscode.window.registerWebviewViewProvider(VIEW_IDS[view], { resolveWebviewView: (webviewView) => this.attach(view, webviewView) }, { webviewOptions: { retainContextWhenHidden: true } }),
    );
  }

  /** Change de projet suivi (multi-racines : dernier projet ouvert dans l'open-space). */
  setRoot(root: string | undefined): void {
    if (root === this.root) return;
    this.disconnect();
    this.connect();
  }

  /** Relaye une sélection faite ailleurs (scène, autre vue). */
  onSelection(root: string, agentId: string | undefined): void {
    if (root !== this.root) return;
    for (const view of ['agents', 'agent'] as const) this.post(view, { type: 'selection', agentId });
  }

  /** Affiche la vue « Agent sélectionné » sans prendre le focus si elle existe déjà. */
  revealDetail(): void {
    const view = this.views.get('agent');
    if (view) view.show(true);
    else void vscode.commands.executeCommand(`${VIEW_IDS.agent}.focus`);
  }

  /** Les réglages VS Code ont changé : l'écran de paramètres doit se rafraîchir. */
  refreshSettings(): void {
    this.postSettings(true);
  }

  dispose(): void {
    this.disconnect();
  }

  private attach(view: SidebarView, webviewView: vscode.WebviewView): void {
    const media = vscode.Uri.joinPath(this.extensionUri, 'dist', 'media');
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [media] };
    webviewView.webview.html = renderSidebarPage(view, {
      scriptUri: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.js')).toString(),
      styleUri: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.css')).toString(),
      cspSource: webviewView.webview.cspSource,
      nonce: createNonce(),
    });
    this.views.set(view, webviewView);
    webviewView.webview.onDidReceiveMessage((message: ClientMessage) => this.onMessage(view, message));
    webviewView.onDidDispose(() => {
      this.views.delete(view);
      if (this.views.size === 0) this.disconnect();
    });
    this.connect();
  }

  private connect(): void {
    if (this.hub || this.views.size === 0) return;
    const root = this.host.currentRoot();
    this.root = root;
    if (!root) return;
    const hub = this.host.acquireHub(root);
    this.hub = hub;
    const unsubscribe = hub.subscribe((message) => this.onHub(message));
    this.unsubscribe = () => {
      unsubscribe();
      this.host.releaseHub(root);
    };
  }

  private disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.hub = undefined;
    this.state = undefined;
    this.settingsSignature = '';
  }

  private onHub(message: HostMessage): void {
    if (message.type !== 'state') return;
    this.state = message.state;
    for (const view of STATE_VIEWS) this.post(view, message);
    this.postSettings(false);
  }

  private postSettings(force: boolean): void {
    if (!this.hub || !this.views.has('settings')) return;
    const general = vscode.workspace.getConfiguration('crewView');
    const data = buildSettings(this.hub, { port: general.get<number>('port') ?? 4719, claudeConfigDir: general.get<string>('claudeConfigDir') ?? '' });
    const signature = JSON.stringify(data);
    if (!force && signature === this.settingsSignature) return;
    this.settingsSignature = signature;
    this.post('settings', { type: 'settings', data });
  }

  private post(view: SidebarView, message: HostMessage): void {
    void this.views.get(view)?.webview.postMessage(message);
  }

  private async onMessage(view: SidebarView, message: ClientMessage): Promise<void> {
    const root = this.root;
    try {
      switch (message.type) {
        case 'ready':
          if (view === 'settings') {
            this.postSettings(true);
            break;
          }
          // Les sections repliées d'abord, pour que le premier rendu soit déjà le bon.
          this.post(view, { type: 'ui', folds: this.memento.get<Record<string, boolean>>(FOLDS_KEY, {}) });
          if (this.state) {
            this.post(view, { type: 'state', state: this.state });
            if (root) this.post(view, { type: 'selection', agentId: this.host.selected(root) });
          }
          break;
        case 'ui': {
          const folds = { ...this.memento.get<Record<string, boolean>>(FOLDS_KEY, {}), ...message.folds };
          await this.memento.update(FOLDS_KEY, folds);
          for (const other of STATE_VIEWS) if (other !== view) this.post(other, { type: 'ui', folds });
          break;
        }
        case 'select':
          if (root) this.host.select(root, message.agentId);
          break;
        case 'openSource':
          if (root) this.host.openSource(root, message.agentId);
          break;
        case 'command':
          await vscode.commands.executeCommand(message.command);
          break;
        case 'updateAgent':
          if (this.hub) applyAgentPatch(this.hub, message.id, message.patch);
          break;
        case 'updateProject':
          if (this.hub) applyProjectPatch(this.hub, message.patch);
          break;
        case 'updateSetting':
          await vscode.workspace.getConfiguration('crewView').update(message.key, message.value, vscode.ConfigurationTarget.Global);
          if (message.key === 'claudeConfigDir') {
            void vscode.window.showInformationMessage('Crew View : le nouveau dossier Claude sera utilisé après rechargement de la fenêtre.');
          }
          break;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Crew View : ${(error as Error).message}`);
      this.postSettings(true);
    }
  }
}
