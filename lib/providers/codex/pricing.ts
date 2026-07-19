import type { Pricing } from '@/lib/types';
import type { PricingResolution } from '../types';
// Relative + explicit .js so raw `node --experimental-strip-types` test runs resolve it.
import { LITELLM_OPENAI_PRICING } from '../../pricing/litellm-pricing.generated.js';

/**
 * Static OpenAI/Codex pricing base = hand-maintained gap models + the committed
 * LiteLLM snapshot. This is the OFFLINE floor: always present, no network.
 *
 * At runtime, `lib/pricing/store.ts` may publish a fresher LiteLLM overlay into a
 * `globalThis` slot; `resolvePricing` reads that slot and falls back to this base.
 * The provider deliberately does NOT import the store — it reads the slot via a
 * loose `globalThis` contract — so this module stays resolvable under raw
 * `node --experimental-strip-types` test runs (which can't resolve aliased /
 * extensionless value imports) and so there's no import cycle with the store.
 *
 * Hand layer covers models LiteLLM does NOT carry (currently none). LiteLLM wins
 * for shared keys (snapshot spread LAST). Refresh with `pnpm update-pricing`.
 */
const HAND_OPENAI: Record<string, Pricing> = {};

export const BUILTIN_PRICING_OPENAI: Record<string, Pricing> = {
  ...HAND_OPENAI,
  ...LITELLM_OPENAI_PRICING,
};

export const FALLBACK_FAMILY_OPENAI: Record<string, Pricing> = {
  gpt: BUILTIN_PRICING_OPENAI['gpt-5.5'],
  o: BUILTIN_PRICING_OPENAI['o3'],
};

interface PricingSlotState {
  openai?: Record<string, Pricing>;
  openaiFallback?: Record<string, Pricing>;
}

function slotState(): PricingSlotState | undefined {
  return (
    globalThis as unknown as { __ccgaugePricing?: { state?: PricingSlotState } }
  ).__ccgaugePricing?.state;
}

function activeOpenAI(): Record<string, Pricing> {
  return slotState()?.openai ?? BUILTIN_PRICING_OPENAI;
}

function activeOpenAIFallback(): Record<string, Pricing> {
  return slotState()?.openaiFallback ?? FALLBACK_FAMILY_OPENAI;
}

const dateSuffix = /-\d{8}$/;
const prefixRe = /^(openai)\//;

export function resolveCodexPricing(model: string): PricingResolution {
  if (!model) return { pricing: null, matchType: 'none', matchedKey: null };
  const pricing = activeOpenAI();
  if (pricing[model]) {
    return { pricing: pricing[model], matchType: 'exact', matchedKey: model };
  }
  const stripped = model.replace(dateSuffix, '');
  if (pricing[stripped]) {
    return {
      pricing: pricing[stripped],
      matchType: 'date-stripped',
      matchedKey: stripped,
    };
  }
  const noPrefix = stripped.replace(prefixRe, '');
  if (pricing[noPrefix]) {
    return {
      pricing: pricing[noPrefix],
      matchType: 'prefix-stripped',
      matchedKey: noPrefix,
    };
  }
  const fallback = activeOpenAIFallback();
  const lower = model.toLowerCase();
  if (lower.startsWith('gpt-') || lower === 'gpt') {
    return {
      pricing: fallback.gpt ?? null,
      matchType: 'family-fallback',
      matchedKey: 'gpt-(latest)',
    };
  }
  if (/^o\d/.test(lower)) {
    return {
      pricing: fallback.o ?? null,
      matchType: 'family-fallback',
      matchedKey: 'o-(latest)',
    };
  }
  return { pricing: null, matchType: 'none', matchedKey: null };
}
