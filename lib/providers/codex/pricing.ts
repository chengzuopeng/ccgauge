import type { Pricing } from '@/lib/types';
import type { PricingResolution } from '../types';
// Relative + explicit .js so raw `node --experimental-strip-types` test runs resolve it.
import { LITELLM_OPENAI_PRICING } from '../../pricing/litellm-pricing.generated.js';

/**
 * Hand-maintained OpenAI/Codex pricing for models LiteLLM's table does NOT
 * carry. LiteLLM currently covers every model ccgauge tracks, so this is empty;
 * it's the documented home for any future bleeding-edge model LiteLLM hasn't
 * indexed yet. LiteLLM wins for shared keys (snapshot spread LAST). Refresh the
 * snapshot with `pnpm update-pricing`.
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

const dateSuffix = /-\d{8}$/;
const prefixRe = /^(openai)\//;

export function resolveCodexPricing(model: string): PricingResolution {
  if (!model) return { pricing: null, matchType: 'none', matchedKey: null };
  if (BUILTIN_PRICING_OPENAI[model]) {
    return {
      pricing: BUILTIN_PRICING_OPENAI[model],
      matchType: 'exact',
      matchedKey: model,
    };
  }
  const stripped = model.replace(dateSuffix, '');
  if (BUILTIN_PRICING_OPENAI[stripped]) {
    return {
      pricing: BUILTIN_PRICING_OPENAI[stripped],
      matchType: 'date-stripped',
      matchedKey: stripped,
    };
  }
  const noPrefix = stripped.replace(prefixRe, '');
  if (BUILTIN_PRICING_OPENAI[noPrefix]) {
    return {
      pricing: BUILTIN_PRICING_OPENAI[noPrefix],
      matchType: 'prefix-stripped',
      matchedKey: noPrefix,
    };
  }
  const lower = model.toLowerCase();
  if (lower.startsWith('gpt-') || lower === 'gpt') {
    return {
      pricing: FALLBACK_FAMILY_OPENAI.gpt,
      matchType: 'family-fallback',
      matchedKey: 'gpt-(latest)',
    };
  }
  if (/^o\d/.test(lower)) {
    return {
      pricing: FALLBACK_FAMILY_OPENAI.o,
      matchType: 'family-fallback',
      matchedKey: 'o-(latest)',
    };
  }
  return { pricing: null, matchType: 'none', matchedKey: null };
}
