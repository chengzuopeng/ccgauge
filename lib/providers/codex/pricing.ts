import type { Pricing } from '@/lib/types';
import type { PricingResolution } from '../types';

export const BUILTIN_PRICING_OPENAI: Record<string, Pricing> = {
  'gpt-5.5': {
    input: 5,
    output: 30,
    cacheRead: 0.5,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-5.4': {
    input: 2.5,
    output: 15,
    cacheRead: 0.25,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-5.4-mini': {
    input: 0.75,
    output: 4.5,
    cacheRead: 0.075,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-5.4-nano': {
    input: 0.2,
    output: 1.25,
    cacheRead: 0.02,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-5.3-codex': {
    input: 1.75,
    output: 14,
    cacheRead: 0.175,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-5': {
    input: 2.5,
    output: 15,
    cacheRead: 0.25,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-5-mini': {
    input: 0.75,
    output: 4.5,
    cacheRead: 0.075,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-5-nano': {
    input: 0.2,
    output: 1.25,
    cacheRead: 0.02,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-5-codex': {
    input: 1.75,
    output: 14,
    cacheRead: 0.175,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-4.1': {
    input: 2,
    output: 8,
    cacheRead: 0.5,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'gpt-4.1-mini': {
    input: 0.4,
    output: 1.6,
    cacheRead: 0.1,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'o3': {
    input: 2,
    output: 8,
    cacheRead: 0.5,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
  'o4-mini': {
    input: 1.1,
    output: 4.4,
    cacheRead: 0.275,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  },
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
