#!/usr/bin/env node
// Lancement hors VS Code : `crew-view [dossier-projet] [--port 4719] [--no-open]`.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CrewHub } from './hub';
import { startServer } from './server';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args.splice(index, 2)[1] : undefined;
  };
  const port = Number(option('--port') ?? 4719);
  const claudeConfigDir = option('--claude-dir');
  const noOpen = args.includes('--no-open');
  const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());

  if (!fs.existsSync(root)) {
    console.error(`Dossier introuvable : ${root}`);
    process.exit(1);
  }

  const hub = new CrewHub({ root, claudeConfigDir });
  hub.start();
  const server = await startServer(hub, path.join(__dirname, 'media'), port);
  console.log(`Crew View — ${path.basename(root)}`);
  console.log(`  Transcripts : ${hub.transcriptDir}`);
  console.log(`  Open-space  : ${server.url}`);
  if (!noOpen) openBrowser(server.url);

  const stop = () => {
    server.close();
    hub.dispose();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function openBrowser(url: string): void {
  const isWsl = process.platform === 'linux' && /microsoft/i.test(safeRead('/proc/version'));
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : isWsl
          ? ['cmd.exe', ['/c', 'start', '""', url]]
          : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log('  (ouvrez l’adresse ci-dessus dans votre navigateur)'));
  child.unref();
}

function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
