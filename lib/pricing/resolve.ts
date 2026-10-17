import { getProvider, ALL_PROVIDER_IDS, DEFAULT_PROVIDER } from '../providers';
import type { ProviderId, PricingResolution, PricingMatchType } from '../providers';
import { splitModelRoute } from '../providers/codex/model-route.js';
import { loadModelOverrides } from './overrides.js';

export type { PricingResolution };

export function isResolvedMatch(matchType: PricingMatchType): boolean {
  return (
    matchType === 'exact' ||
    matchType === 'date-stripped' ||
    matchType === 'prefix-stripped' ||
    matchType === 'override'
  );
}

export function resolvePricing(
  model: string,
  source: ProviderId = DEFAULT_PROVIDER,
): PricingResolution {
  const overrides = loadModelOverrides();
  const canonical = splitModelRoute(model).model;
  const direct = overrides.prices.get(canonical.toLowerCase());
  if (direct) return { pricing: direct, matchType: 'override', matchedKey: canonical };

  const alias = overrides.aliases.get(canonical.toLowerCase());
  const target = alias ? splitModelRoute(alias).model : canonical;
  if (alias) {
    const viaAlias = overrides.prices.get(target.toLowerCase());
    if (viaAlias) return { pricing: viaAlias, matchType: 'override', matchedKey: target };
  }

  const own = getProvider(source).resolvePricing(alias ? target : model);
  if (own.pricing) return own;
  for (const id of ALL_PROVIDER_IDS) {
    if (id === source) continue;
    const other = getProvider(id).resolvePricing(target);
    if (other.pricing) return other;
  }
  return own;
}
