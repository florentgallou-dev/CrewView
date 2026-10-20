// Affichage de la consommation : une ligne par compteur, valeur exacte au survol.

import type { RequestSummary, TokenUsage } from '../types';
import { addUsage, emptyUsage, tokensRead } from '../usage';
import { el } from './dom';

export function formatTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(n);
}

export function formatUsd(n: number): string {
  if (n > 0 && n < 0.01) return '< 0.01 $';
  return `${n.toFixed(2)} $`;
}

const exact = (n: number) => n.toLocaleString('fr-FR');

/** Lignes de consommation (liste de définitions). */
export function usageLines(usage: TokenUsage): HTMLElement {
  const lines: [string, string, string?, string?][] = [];
  const tokens = (label: string, value: number, className?: string) => lines.push([label, formatTokens(value), exact(value), className]);

  lines.push(['Appels au modèle', String(usage.calls)]);
  const models = Object.entries(usage.models);
  if (models.length) lines.push(['Modèle', models.map(([model, calls]) => (models.length > 1 ? `${model} (${calls})` : model)).join(', ')]);
  tokens('Entrée', usage.input);
  tokens('Cache écrit', usage.cacheWrite);
  if (usage.cacheWrite5m) tokens('dont 5 min', usage.cacheWrite5m, 'sub');
  if (usage.cacheWrite1h) tokens('dont 1 h', usage.cacheWrite1h, 'sub');
  tokens('Cache lu', usage.cacheRead);
  tokens('Tokens lus', tokensRead(usage), 'total');
  tokens('Tokens produits', usage.output, 'total');
  tokens('dont réflexion', usage.thinking, 'sub');
  if (usage.webSearches) lines.push(['Recherches web', String(usage.webSearches)]);
  if (usage.webFetches) lines.push(['Pages web lues', String(usage.webFetches)]);
  lines.push([
    'Coût estimé',
    `≈ ${formatUsd(usage.costUsd)}${usage.unpricedCalls ? ` (+ ${usage.unpricedCalls} appel${usage.unpricedCalls > 1 ? 's' : ''} sans tarif)` : ''}`,
    'Tarifs publics de l’API Anthropic',
    'cost',
  ]);

  return el('dl', { className: 'usage' },
    ...lines.flatMap(([label, value, title, className]) => [
      el('dt', { className: className ?? '' }, label),
      el('dd', { className: className ?? '', title: title ?? '' }, value),
    ]),
  );
}

/** Résumé sur une ligne : produits, lus et coût estimé. */
export function usageSummary(usage: TokenUsage): string {
  return `produits ${formatTokens(usage.output)} · lus ${formatTokens(tokensRead(usage))} · ≈ ${formatUsd(usage.costUsd)}`;
}

export function sumRequests(requests: RequestSummary[]): TokenUsage {
  const total = emptyUsage();
  for (const request of requests) addUsage(total, request.total);
  return total;
}

export function requestTime(request: RequestSummary): string {
  return new Date(request.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
