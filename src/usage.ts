// Relevé de consommation d'une réponse du modèle et cumul (sans dépendance Node : utilisable par les vues).

import { estimateCostUsd } from './pricing';
import type { TokenUsage } from './types';

export function emptyUsage(): TokenUsage {
  return { calls: 0, input: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, thinking: 0, webSearches: 0, webFetches: 0, models: {}, costUsd: 0, unpricedCalls: 0 };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- message brut du transcript */
/** Consommation d'une réponse (`message.usage` d'un enregistrement assistant). */
export function usageOfMessage(message: any): TokenUsage | undefined {
  const usage = message?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const model = typeof message.model === 'string' ? message.model : 'inconnu';
  const result: TokenUsage = {
    ...emptyUsage(),
    calls: 1,
    input: n(usage.input_tokens),
    cacheWrite: n(usage.cache_creation_input_tokens),
    cacheWrite5m: n(usage.cache_creation?.ephemeral_5m_input_tokens),
    cacheWrite1h: n(usage.cache_creation?.ephemeral_1h_input_tokens),
    cacheRead: n(usage.cache_read_input_tokens),
    output: n(usage.output_tokens),
    thinking: n(usage.output_tokens_details?.thinking_tokens),
    webSearches: n(usage.server_tool_use?.web_search_requests),
    webFetches: n(usage.server_tool_use?.web_fetch_requests),
    models: { [model]: 1 },
  };
  const cost = estimateCostUsd(model, result, { fast: usage.speed === 'fast', inferenceGeo: usage.inference_geo });
  if (cost === undefined) result.unpricedCalls = 1;
  else result.costUsd = cost;
  return result;
}

/** Ajoute (sign = 1) ou retire (sign = -1) `delta` de `target`. */
export function addUsage(target: TokenUsage, delta: TokenUsage, sign: 1 | -1 = 1): void {
  for (const key of ['calls', 'input', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output', 'thinking', 'webSearches', 'webFetches', 'costUsd', 'unpricedCalls'] as const) {
    target[key] += sign * delta[key];
  }
  for (const [model, calls] of Object.entries(delta.models)) {
    const next = (target.models[model] ?? 0) + sign * calls;
    if (next > 0) target.models[model] = next;
    else delete target.models[model];
  }
}

/** Tokens lus par le modèle : entrée + cache écrit + cache lu. */
export function tokensRead(usage: TokenUsage): number {
  return usage.input + usage.cacheWrite + usage.cacheRead;
}
