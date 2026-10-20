// Page de la scène, commune au panneau VS Code et au navigateur.

export interface PageOptions {
  scriptUri: string;
  styleUri: string;
  /** Source autorisée pour les ressources (cspSource du webview, ou 'self'). */
  cspSource: string;
  nonce: string;
  transport: 'vscode' | 'sse';
}

export function renderPage(options: PageOptions): string {
  const csp = [
    "default-src 'none'",
    `img-src ${options.cspSource} data:`,
    `style-src ${options.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${options.nonce}'`,
    `connect-src ${options.cspSource}`,
  ].join('; ');
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Crew View</title>
  <link rel="stylesheet" href="${options.styleUri}">
</head>
<body data-transport="${options.transport}">
  <canvas id="scene" aria-label="Open-space des agents"></canvas>
  <div id="overlay" aria-live="polite"></div>
  <header id="topbar">
    <span id="status-dot" class="dot"></span>
    <strong id="project">Crew View</strong>
    <span id="session"></span>
  </header>
  <div id="notice" hidden></div>
  <div id="dialog" hidden><span id="dialog-speaker"></span><span id="dialog-text"></span></div>
  <aside id="panel" hidden></aside>
  <script nonce="${options.nonce}" src="${options.scriptUri}"></script>
</body>
</html>`;
}

export function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) nonce += chars[Math.floor(Math.random() * chars.length)];
  return nonce;
}
