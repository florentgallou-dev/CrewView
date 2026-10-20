// Mini-serveur local pour afficher la scène dans un navigateur (Server-Sent Events).

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { createNonce, renderPage } from './html';
import type { CrewHub } from './hub';

const MEDIA: Record<string, string> = {
  'webview.js': 'text/javascript; charset=utf-8',
  'webview.css': 'text/css; charset=utf-8',
};

export interface RunningServer {
  url: string;
  close(): void;
}

export async function startServer(hub: CrewHub, mediaDir: string, preferredPort: number): Promise<RunningServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderPage({ scriptUri: '/media/webview.js', styleUri: '/media/webview.css', cspSource: "'self'", nonce: createNonce(), transport: 'sse' }));
    } else if (url.pathname.startsWith('/media/') && MEDIA[url.pathname.slice(7)]) {
      const name = url.pathname.slice(7);
      fs.readFile(path.join(mediaDir, name), (error, data) => {
        if (error) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': MEDIA[name], 'Cache-Control': 'no-store' });
        res.end(data);
      });
    } else if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const unsubscribe = hub.subscribe((message) => res.write(`data: ${JSON.stringify(message)}\n\n`));
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } else {
      res.writeHead(404).end();
    }
  });

  const port = await listen(server, preferredPort);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => server.close(),
  };
}

/** Écoute sur le port demandé ou l'un des 10 suivants s'il est occupé. */
function listen(server: http.Server, port: number, attempt = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE' && attempt < 10) resolve(listen(server, port + 1, attempt + 1));
      else reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}
