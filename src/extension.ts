// Extension VS Code : panneau de l'open-space, ouverture navigateur, outils de configuration.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_FILE, loadConfig, type CrewConfig } from './config';
import { CLAUDE_AGENTS_DIR, planConversion, writeConversion } from './convert';
import { discoverAgents } from './discovery';
import { createNonce, renderPage } from './html';
import { CrewHub } from './hub';
import { placeAgents } from './layout';
import { startServer, type RunningServer } from './server';
import type { ClientMessage } from './types';

const hubs = new Map<string, CrewHub>();
const panels = new Map<string, vscode.WebviewPanel>();
const servers = new Map<string, Promise<RunningServer>>();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('crewView.open', async () => {
      const root = await pickRoot();
      if (root) openPanel(context, root);
    }),
    vscode.commands.registerCommand('crewView.openInBrowser', async () => {
      const root = await pickRoot();
      if (root) await openInBrowser(context, root);
    }),
    vscode.commands.registerCommand('crewView.generateClaudeAgents', async () => {
      const root = await pickRoot();
      if (root) await generateClaudeAgents(root);
    }),
    vscode.commands.registerCommand('crewView.initConfig', async () => {
      const root = await pickRoot();
      if (root) await initConfig(root);
    }),
  );

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.text = '$(organization) Crew';
  item.tooltip = 'Ouvrir l’open-space des agents';
  item.command = 'crewView.open';
  item.show();
  context.subscriptions.push(item);
}

export function deactivate(): void {
  for (const server of servers.values()) server.then((s) => s.close(), () => undefined);
  for (const hub of hubs.values()) hub.dispose();
  hubs.clear();
  servers.clear();
}

async function pickRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage('Crew View : ouvrez d’abord le dossier d’un projet.');
    return undefined;
  }
  if (folders.length === 1) return folders[0].uri.fsPath;
  const picked = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Projet à afficher' });
  return picked?.uri.fsPath;
}

function hubFor(root: string): CrewHub {
  let hub = hubs.get(root);
  if (!hub) {
    const claudeConfigDir = vscode.workspace.getConfiguration('crewView').get<string>('claudeConfigDir');
    hub = new CrewHub({ root, claudeConfigDir });
    hub.start();
    hubs.set(root, hub);
  }
  return hub;
}

/** Libère le hub d'un projet quand plus aucune vue ne l'utilise. */
function releaseHub(root: string): void {
  if (panels.has(root) || servers.has(root)) return;
  hubs.get(root)?.dispose();
  hubs.delete(root);
}

function openPanel(context: vscode.ExtensionContext, root: string): void {
  const existing = panels.get(root);
  if (existing) {
    existing.reveal();
    return;
  }
  const media = vscode.Uri.joinPath(context.extensionUri, 'dist', 'media');
  const panel = vscode.window.createWebviewPanel('crewView', `Crew · ${path.basename(root)}`, vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [media],
  });
  panel.webview.html = renderPage({
    scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview.js')).toString(),
    styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview.css')).toString(),
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    transport: 'vscode',
  });

  const hub = hubFor(root);
  let unsubscribe: (() => void) | undefined;
  panel.webview.onDidReceiveMessage((message: ClientMessage) => {
    if (message.type === 'ready') {
      unsubscribe?.();
      unsubscribe = hub.subscribe((m) => void panel.webview.postMessage(m));
    } else if (message.type === 'openSource') {
      const source = hub.sourceOf(message.agentId);
      if (source) void vscode.window.showTextDocument(vscode.Uri.file(source), { viewColumn: vscode.ViewColumn.One });
    }
  });
  panel.onDidDispose(() => {
    unsubscribe?.();
    panels.delete(root);
    releaseHub(root);
  });
  panels.set(root, panel);
}

async function openInBrowser(context: vscode.ExtensionContext, root: string): Promise<void> {
  let server = servers.get(root);
  if (!server) {
    const port = vscode.workspace.getConfiguration('crewView').get<number>('port') ?? 4719;
    server = startServer(hubFor(root), path.join(context.extensionPath, 'dist', 'media'), port);
    servers.set(root, server);
  }
  try {
    const { url } = await server;
    // En session distante (WSL, SSH), asExternalUri met en place la redirection de port.
    const external = await vscode.env.asExternalUri(vscode.Uri.parse(url));
    await vscode.env.openExternal(external);
  } catch (error) {
    servers.delete(root);
    releaseHub(root);
    void vscode.window.showErrorMessage(`Crew View : impossible de démarrer le serveur local (${(error as Error).message}).`);
  }
}

async function generateClaudeAgents(root: string): Promise<void> {
  const plan = planConversion(root);
  if (plan.agents.length === 0) {
    void vscode.window.showInformationMessage('Crew View : aucun agent Copilot (.agent.md) à convertir dans ce projet.');
    return;
  }
  const list = plan.agents.map((a) => `• ${a.name} → ${a.target}${a.exists ? ' (existe déjà)' : ''}`).join('\n');
  const conflicts = plan.agents.filter((a) => a.exists);
  const choices = conflicts.length ? ['Tout générer (écraser)', 'Seulement les nouveaux'] : ['Générer'];
  const answer = await vscode.window.showInformationMessage(
    `Générer ${plan.agents.length} subagent(s) Claude Code dans ${CLAUDE_AGENTS_DIR} ?`,
    { modal: true, detail: list },
    ...choices,
  );
  if (!answer) return;
  const selected = answer === 'Seulement les nouveaux' ? plan.agents.filter((a) => !a.exists) : plan.agents;
  const written = writeConversion(root, selected);

  const notes: string[] = [];
  if (plan.skippedOrchestrators.length) {
    notes.push(`${plan.skippedOrchestrators.map((a) => a.name).join(', ')} : non converti, c’est la session principale de Claude Code qui joue ce rôle.`);
  }
  const unmapped = plan.agents.flatMap((a) => a.unmappedTools.map((t) => `${a.name}/${t}`));
  if (unmapped.length) notes.push(`Outils Copilot sans équivalent, ignorés : ${unmapped.join(', ')}.`);
  const open = await vscode.window.showInformationMessage(
    `Crew View : ${written.length} agent(s) généré(s). ${notes.join(' ')}`,
    'Ouvrir le dossier',
  );
  if (open && written[0]) await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, written[0])));
}

async function initConfig(root: string): Promise<void> {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    const { config } = loadConfig(root);
    const placed = placeAgents(discoverAgents(root, config.agentsDirs), config);
    const main = placed.find((a) => a.isMain);
    const initial: CrewConfig = {
      agentsDirs: [],
      orchestrator: main && main.id !== 'main' ? main.id : undefined,
      agents: Object.fromEntries(
        placed.map((a) => [a.id, { label: a.name, color: a.color, accessory: a.accessory, desk: [a.desk.x, a.desk.y] as [number, number] }]),
      ),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
  }
  await vscode.window.showTextDocument(vscode.Uri.file(file));
}
