// Tarifs publics de l'API Anthropic (dollars par million de tokens), relevés le 2026-10-20 sur
// https://platform.claude.com/docs/en/about-claude/pricing — à mettre à jour si la grille change.
// Servent uniquement à l'estimation du coût : les tokens affichés sont, eux, les chiffres réels du transcript.
// Écriture du cache : 1,25 × l'entrée (5 min), 2 × (1 h). Lecture du cache : taux propre à chaque modèle.

import type { TokenUsage } from './types';

interface Rate {
  input: number;
  output: number;
  cacheRead: number;
}

const RATES: Record<string, Rate> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08 },
};

/** Claude Haiku 5.5 : deux grilles selon la taille du prompt (cache compris), seuil 100 000 tokens. */
const HAIKU_5_5 = { small: { input: 0.1, output: 0.5, cacheRead: 0.01 }, large: { input: 0.5, output: 2.5, cacheRead: 0.05 }, threshold: 100_000 };

/** Mode rapide : 2 × le tarif standard. */
const FAST_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8']);

/** Inférence limitée aux États-Unis (`inference_geo: "us"`) : 1,1 × sur les modèles 4.6 et suivants. */
const US_GEO_MULTIPLIER = 1.1;
const PRE_4_6 = new Set(['claude-opus-4-5', 'claude-opus-4-1', 'claude-opus-4', 'claude-sonnet-4-5', 'claude-sonnet-4', 'claude-haiku-4-5', 'claude-3-5-haiku']);

/** Recherche web : 10 $ les 1 000. La lecture de pages web n'est pas facturée en plus des tokens. */
const WEB_SEARCH_USD = 10 / 1000;

/** Identifiant de modèle sans suffixe de contexte (« [1m] ») ni date. */
export function baseModelId(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '').trim();
}

export interface PricingContext {
  fast?: boolean;
  inferenceGeo?: string;
}

/** Coût estimé d'une réponse ; undefined si le modèle (ou le mode) n'a pas de tarif connu. */
export function estimateCostUsd(model: string, usage: TokenUsage, context: PricingContext = {}): number | undefined {
  const id = baseModelId(model);
  let rate: Rate | undefined = RATES[id];
  if (id === 'claude-haiku-5-5') {
    const prompt = usage.input + usage.cacheWrite + usage.cacheRead;
    rate = prompt > HAIKU_5_5.threshold ? HAIKU_5_5.large : HAIKU_5_5.small;
  }
  if (!rate) return undefined;
  if (context.fast && !FAST_MODELS.has(id)) return undefined;

  let multiplier = context.fast ? 2 : 1;
  if (context.inferenceGeo === 'us' && !PRE_4_6.has(id)) multiplier *= US_GEO_MULTIPLIER;

  // Sans détail par durée, l'écriture est comptée au tarif 5 minutes (durée par défaut).
  const unsplit = Math.max(0, usage.cacheWrite - usage.cacheWrite5m - usage.cacheWrite1h);
  const perToken =
    usage.input * rate.input +
    (usage.cacheWrite5m + unsplit) * rate.input * 1.25 +
    usage.cacheWrite1h * rate.input * 2 +
    usage.cacheRead * rate.cacheRead +
    usage.output * rate.output;
  return (perToken * multiplier) / 1_000_000 + usage.webSearches * WEB_SEARCH_USD;
}
