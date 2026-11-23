// Barre d'état de VS Code, à droite de « Crew » : contexte de la session principale et coût estimé du projet courant.

import * as vscode from 'vscode';
import { statusSummary, type ContextWindowSetting } from './context';
import type { CrewHub } from './hub';
import type { SceneState } from './types';

export interface StatusBarHost {
  acquireHub(root: string): CrewHub;
  releaseHub(root: string): void;
}

export class CrewStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('crewView.session', vscode.StatusBarAlignment.Left, 49);
  private root?: string;
  private state?: SceneState;
  private unsubscribe?: () => void;
  private signature = '';
  /** La durée de session avance même quand le transcript ne bouge pas. */
  private readonly clock = setInterval(() => this.render(), 30_000);

  constructor(private readonly host: StatusBarHost) {
    this.item.name = 'Crew View : contexte et coût';
    this.item.command = { command: 'crewView.requests.focus', title: 'Voir les demandes' };
  }

  setRoot(root: string | undefined): void {
    if (root === this.root) return;
    this.detach();
    this.root = root;
    this.state = undefined;
    if (root) {
      const hub = this.host.acquireHub(root);
      const unsubscribe = hub.subscribe((message) => {
        if (message.type !== 'state') return;
        this.state = message.state;
        this.render();
      });
      this.unsubscribe = () => {
        unsubscribe();
        this.host.releaseHub(root);
      };
    }
    this.render();
  }

  /** À appeler quand le réglage de la fenêtre de contexte change. */
  render(): void {
    const setting = vscode.workspace.getConfiguration('crewView').get<ContextWindowSetting>('contextWindow') ?? 'auto';
    const summary = this.state ? statusSummary(this.state, setting) : undefined;
    const signature = JSON.stringify(summary ?? null);
    if (signature === this.signature) return;
    this.signature = signature;
    if (!summary) {
      this.item.hide();
      return;
    }
    this.item.text = summary.text;
    this.item.tooltip = new vscode.MarkdownString([...summary.details, '', '_Clic : détail des demandes._'].join('  \n'));
    this.item.backgroundColor =
      summary.level === 'normal' ? undefined : new vscode.ThemeColor(`statusBarItem.${summary.level === 'error' ? 'errorBackground' : 'warningBackground'}`);
    this.item.show();
  }

  dispose(): void {
    clearInterval(this.clock);
    this.detach();
    this.item.dispose();
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
