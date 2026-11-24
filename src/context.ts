// Remplissage du contexte de la session principale et résumé affiché dans la barre d'état de VS Code.
// Sans dépendance Node ni VS Code : testable seul.

import { baseModelId } from './pricing';
import type { SceneState } from './types';

export type ContextWindowSetting = 'auto' | '200k' | '1m';

const WINDOW_1M = 1_000_000;
const WINDOW_200K = 200_000;

/**
 * Modèles pour lesquels Claude Code compte une fenêtre de 200 k (sa table de modèles, version 2.1) ;
 * les modèles plus récents ont 1 M d'office. Un suffixe « [1m] » force 1 M.
 */
const WINDOW_200K_MODELS = /^claude-(3|opus-4(-[0156])?$|sonnet-4(-[56])?$|haiku-4-5$)/;

/** Taille de la fenêtre de contexte retenue pour un modèle. */
export function contextWindowOf(model: string, setting: ContextWindowSetting = 'auto'): number {
  if (setting === '1m') return WINDOW_1M;
  if (setting === '200k') return WINDOW_200K;
  if (/\[1m\]/i.test(model)) return WINDOW_1M;
  return WINDOW_200K_MODELS.test(baseModelId(model)) ? WINDOW_200K : WINDOW_1M;
}

export interface StatusSummary {
  /** Texte de la barre d'état, sans l'icône Crew. */
  text: string;
  /** Lignes de l'infobulle (Markdown). */
  details: string[];
  level: 'normal' | 'warning' | 'error';
}

/** Résumé de la session suivie ; undefined quand aucune session n'est suivie. */
export function statusSummary(state: SceneState, setting: ContextWindowSetting = 'auto', now = Date.now()): StatusSummary | undefined {
  if (!state.watching) return undefined;
  const parts: string[] = [];
  const details: string[] = [];
  let level: StatusSummary['level'] = 'normal';

  const context = state.context;
  if (context) {
    const window = contextWindowOf(context.model, setting);
    const percent = Math.min(100, Math.round((context.tokens / window) * 100));
    parts.push(`$(${percent >= 90 ? 'circle-large-filled' : 'pie-chart'}) ${percent} %`);
    if (percent >= 90) level = 'error';
    else if (percent >= 80) level = 'warning';
    details.push(`**Contexte de la session principale :** ${percent} % (${kilo(context.tokens)} / ${kilo(window)} tokens)`);
    details.push(`Modèle : \`${context.model}\` — fenêtre ${setting === 'auto' ? 'détectée' : 'forcée par le réglage'} : ${kilo(window)}`);
  }

  const total = state.requests.reduce((sum, request) => sum + request.total.costUsd, 0);
  const unpriced = state.requests.reduce((sum, request) => sum + request.total.unpricedCalls, 0);
  if (state.requests.length) {
    parts.push(`≈ ${dollars(total)}`);
    details.push(`**Coût estimé de la session :** ≈ ${dollars(total)} (tarifs publics de l'API, sous-agents compris)`);
    const current = state.requests[state.requests.length - 1];
    details.push(`Demande en cours : ≈ ${dollars(current.total.costUsd)}`);
    if (unpriced) details.push(`${unpriced} appel(s) sans tarif connu, exclus de l'estimation`);
  }
  if (state.sessionCost) details.push(`Coût enregistré par Claude Code : ${dollars(state.sessionCost.totalUsd)}`);

  const background = state.agents.flatMap((agent) => agent.runtime.background.map((task) => ({ agent: agent.name, task })));
  if (background.length) {
    details.push(`**En arrière-plan :** ${background.length} commande(s) en cours`);
    for (const { agent, task } of background) details.push(`- ${task.label} — ${agent}, depuis ${clockTime(task.since, now)}`);
  }

  if (state.startedAt !== undefined) {
    const open = duration(now - state.startedAt);
    parts.push(`$(clock) ${open}`);
    details.push(`**Session ouverte depuis** ${clockTime(state.startedAt, now)} (${open})`);
    if (state.lastActivityAt !== undefined) {
      const idle = now - state.lastActivityAt;
      details.push(idle < 60_000 ? 'Dernier échange : à l’instant' : `Dernier échange : il y a ${duration(idle)}`);
    }
  }
  if (!parts.length) return undefined;
  details.push("_Avec un abonnement Pro ou Max, ce montant est l'équivalent au tarif de l'API, pas ce qui est facturé._");
  return { text: parts.join(' · '), details, level };
}

/** « 12 min », « 1 h 05 », « 2 j 3 h ». */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

/** Heure de début (« 14 h 05 »), précédée de la date si ce n'était pas aujourd'hui. */
function clockTime(at: number, now: number): string {
  const date = new Date(at);
  const time = `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`;
  return date.toDateString() === new Date(now).toDateString() ? time : `le ${date.toLocaleDateString('fr-FR')} à ${time}`;
}

function kilo(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(2)} M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)} k`;
  return String(tokens);
}

function dollars(usd: number): string {
  return `${usd.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}
