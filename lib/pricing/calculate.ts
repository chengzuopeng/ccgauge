import type { AssistantRecord, CostBreakdown } from '../types';
import { getProvider } from '../providers';
import { costFromUsage, totalTokens } from './cost-from-usage';
import { resolvePricing } from './resolve';

export { costFromUsage, totalTokens };

export function pricedCostOfRecord(rec: AssistantRecord): { cost: CostBreakdown; priced: boolean } {
  const provider = getProvider(rec.source);
  const { pricing } = resolvePricing(rec.model, rec.source);
  return {
    cost: provider.costFromUsage(rec.usage, pricing, rec.model, rec.serviceTier),
    priced: pricing !== null,
  };
}

export function costOfRecord(rec: AssistantRecord): CostBreakdown {
  return pricedCostOfRecord(rec).cost;
}
