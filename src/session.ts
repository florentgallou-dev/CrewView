// Suit la session Claude Code active d'un projet : fichier principal + fichiers des subagents.
// Par sondage (fiable sous Windows, WSL et partages réseau, contrairement à fs.watch).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { JsonlTailer } from './tail';
import { timeOf, type SessionTracker, type SubagentMeta } from './tracker';

const POLL_MS = 400;
const SESSION_SCAN_EVERY = 5;
/** Une autre session ne prend la main que si la session suivie est silencieuse depuis ce délai. */
const SWITCH_AFTER_SILENCE_MS = 30_000;

interface SessionFile {
  file: string;
  mtime: number;
}

export class SessionWatcher {
  private timer?: NodeJS.Timeout;
  private tick = 0;
  private current?: SessionFile;
  private tracker?: SessionTracker;
  private mainTail?: JsonlTailer;
  private readonly subTails = new Map<string, JsonlTailer>();
  private readonly subMeta = new Map<string, SubagentMeta>();
  private knownFiles?: Set<string>;

  constructor(
    private readonly transcriptDir: string,
    private readonly createTracker: () => SessionTracker,
    private readonly onAttach: (tracker: SessionTracker, sessionId: string) => void,
  ) {}

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private poll(): void {
    if (this.tick++ % SESSION_SCAN_EVERY === 0) this.chooseSession();
    if (!this.tracker || !this.mainTail || !this.current) return;
    // Transcript réécrit : l'état reconstruit n'est plus valable, on relit tout.
    if (this.mainTail.shrank()) this.attach(this.current);
    for (const record of this.mainTail.readNew()) this.tracker.handleMain(record);
    this.pollSubagents();
    this.tracker.sweep(Date.now());
  }

  private chooseSession(): void {
    const sessions = this.listSessions();
    const isNew = (s: SessionFile) => this.knownFiles !== undefined && !this.knownFiles.has(s.file);
    this.knownFiles = new Set(sessions.map((s) => s.file));
    const newest = sessions[0];
    if (!newest || newest.file === this.current?.file) {
      if (newest) this.current = newest;
      return;
    }
    const currentMtime = sessions.find((s) => s.file === this.current?.file)?.mtime ?? 0;
    const silent = Date.now() - currentMtime > SWITCH_AFTER_SILENCE_MS;
    if (!this.current || isNew(newest) || silent) this.attach(newest);
  }

  private listSessions(): SessionFile[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.transcriptDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith('.jsonl') && !name.startsWith('agent-'))
      .flatMap((name) => {
        const file = path.join(this.transcriptDir, name);
        try {
          return [{ file, mtime: fs.statSync(file).mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  /** Relit la session complète sans animation pour reconstituer l'état, puis passe en direct. */
  private attach(session: SessionFile): void {
    this.current = session;
    this.subTails.clear();
    this.subMeta.clear();
    const tracker = this.createTracker();
    this.tracker = tracker;
    this.mainTail = new JsonlTailer(session.file);
    tracker.replaying = true;
    // Les fichiers sont relus ensemble, dans l'ordre chronologique : une notification de fin
    // dans le fichier principal ne doit pas précéder les derniers messages du subagent.
    const steps: { at: number; apply: () => void }[] = this.mainTail.readNew().map((record) => ({ at: timeOf(record), apply: () => tracker.handleMain(record) }));
    this.pollSubagents((at, apply) => steps.push({ at, apply }));
    steps.sort((a, b) => a.at - b.at).forEach((step) => step.apply());
    tracker.replaying = false;
    tracker.settle(Date.now());
    this.onAttach(tracker, path.basename(session.file, '.jsonl'));
  }

  /** Lit les fichiers des subagents ; `defer` permet de différer le traitement (relecture triée). */
  private pollSubagents(defer?: (at: number, apply: () => void) => void): void {
    const tracker = this.tracker;
    if (!tracker || !this.current) return;
    const run = (at: number, apply: () => void) => (defer ? defer(at, apply) : apply());
    const dir = path.join(this.current.file.replace(/\.jsonl$/, ''), 'subagents');
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
    } catch {
      // Pas encore de subagent dans cette session.
    }
    const fresh = new Set<string>();
    for (const name of names) {
      const fileAgentId = name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
      if (!this.subTails.has(fileAgentId)) {
        const meta = readMeta(path.join(dir, name.replace(/\.jsonl$/, '.meta.json')));
        if (!meta) continue; // méta pas encore écrite : on réessaiera au prochain passage
        this.subTails.set(fileAgentId, new JsonlTailer(path.join(dir, name)));
        fresh.add(fileAgentId);
        this.subMeta.set(fileAgentId, meta);
      }
    }
    for (const [fileAgentId, tail] of this.subTails) {
      const records = tail.readNew();
      if (fresh.has(fileAgentId)) {
        // Enregistré juste avant son premier message (même horodatage, l'ordre stable est conservé).
        const meta = this.subMeta.get(fileAgentId)!;
        const at = records.length ? timeOf(records[0]) : Date.now();
        run(at, () => tracker.registerSubagent(fileAgentId, meta, at));
      }
      for (const record of records) run(timeOf(record), () => tracker.handleSubagent(fileAgentId, record));
    }
  }
}

function readMeta(file: string): SubagentMeta | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SubagentMeta;
  } catch {
    return undefined;
  }
}
