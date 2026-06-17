import type { AssistantRecord, CostBreakdown } from '../types';
import { getProvider } from '../providers';
import { costFromUsage, totalTokens } from './cost-from-usage';

export { costFromUsage, totalTokens };

export function costOfRecord(rec: AssistantRecord): CostBreakdown {
  const provider = getProvider(rec.source);
  const { pricing } = provider.resolvePricing(rec.model);
  return provider.costFromUsage(rec.usage, pricing, rec.model);
}
