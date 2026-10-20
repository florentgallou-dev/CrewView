// Fiche détaillée d'un agent (panneau du navigateur et vue « Agent sélectionné »).
// Sections repliables : Rôle, Tâche, Activité, Historique (état mémorisé par l'appelant).

import type { RequestSummary, SceneAgent } from '../types';
import { type Child, el } from './dom';
import { STATUS_COLORS, STATUS_LABELS } from './status';
import { requestTime, usageLines, usageSummary } from './usageView';

export interface DetailOptions {
  requests?: RequestSummary[];
  onOpenSource?: () => void;
  /** Sections repliées (« role », « task », « activity », « history ») et détails ouverts (« request:<id> »). */
  isOpen(key: string, byDefault: boolean): boolean;
  onToggle(key: string, open: boolean): void;
}

export function renderAgentDetail(agent: SceneAgent, options: DetailOptions): Child[] {
  const r = agent.runtime;
  const kind = agent.isMain ? 'Session principale' : agent.temp ? 'Intérimaire (agent intégré)' : 'Agent du projet';
  const fold = (key: string, title: string, byDefault: boolean, ...children: Child[]) => collapsible(key, title, byDefault, options, 'section', ...children);

  const perRequest = (options.requests ?? [])
    .filter((request) => request.byAgent[agent.id]?.calls)
    .reverse()
    .map((request) =>
      collapsible(`request:${request.id}`, `${requestTime(request)} · ${request.prompt}`, false, options, 'request', el('p', { className: 'muted summary-line' }, usageSummary(request.byAgent[agent.id])), usageLines(request.byAgent[agent.id])),
    );

  return [
    el('div', { className: 'panel-head' },
      el('span', { className: 'swatch', style: `background:${agent.color}` }),
      el('div', {}, el('h2', {}, agent.name), el('div', { className: 'muted' }, kind)),
    ),
    el('div', { className: 'status-line' },
      el('span', { className: 'status-dot', style: `background:${STATUS_COLORS[r.status]}` }),
      `${STATUS_LABELS[r.status]}${r.activeTasks > 1 ? ` · ${r.activeTasks} tâches` : ''}`,
    ),
    agent.description && fold('role', 'Rôle', true, el('p', { className: 'description' }, agent.description)),
    (r.task || r.files.length > 0) &&
      fold('task', r.activeTasks > 0 ? 'Tâche en cours' : 'Dernière tâche', true,
        r.task && el('p', {}, r.task),
        r.files.length > 0 && el('ul', { className: 'files' }, ...r.files.map((f) => el('li', { title: f }, f.split(/[\\/]/).pop() ?? f))),
      ),
    fold('activity', `Activité — ${agent.name}`, true,
      el('dl', { className: 'stats' }, el('dt', {}, 'Dernier outil'), el('dd', {}, r.tool ?? '—')),
      el('h4', {}, 'Session'),
      usageLines(r.usage),
      perRequest.length > 0 && el('h4', {}, 'Par demande'),
      ...perRequest,
    ),
    fold('history', 'Historique', true,
      r.history.length
        ? el('ol', { className: 'history' }, ...[...r.history].reverse().map((h) =>
            el('li', {}, el('time', {}, new Date(h.at).toLocaleTimeString('fr-FR')), el('span', { className: 'status-dot', style: `background:${STATUS_COLORS[h.status]}` }), h.text)))
        : el('p', { className: 'muted' }, 'Aucune activité dans cette session.'),
    ),
    agent.source &&
      (options.onOpenSource
        ? el('button', { className: 'link', onclick: options.onOpenSource }, `Ouvrir ${agent.source}`)
        : el('p', { className: 'muted source' }, agent.source)),
  ];
}

/** Bloc repliable dont l'état est conservé par l'appelant (les vues sont reconstruites à chaque mise à jour). */
export function collapsible(key: string, title: string, byDefault: boolean, options: Pick<DetailOptions, 'isOpen' | 'onToggle'>, className: string, ...children: Child[]): HTMLDetailsElement {
  const details = el('details', { className: `fold ${className}`, open: options.isOpen(key, byDefault) }, el('summary', {}, title), ...children);
  details.addEventListener('toggle', () => {
    if (details.open !== options.isOpen(key, byDefault)) options.onToggle(key, details.open);
  });
  return details;
}
