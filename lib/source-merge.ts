
import type { AggregateBucket } from './types';

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
  saved: number;
  requests: number;
}

const ZERO: Totals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 0,
  cost: 0,
  saved: 0,
  requests: 0,
};

export function combineTotals(parts: Totals[]): Totals {
  if (parts.length === 0) return { ...ZERO };
  if (parts.length === 1) return parts[0];
  return parts.reduce(
    (acc, p) => ({
      inputTokens: acc.inputTokens + p.inputTokens,
      outputTokens: acc.outputTokens + p.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + p.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + p.cacheCreationTokens,
      totalTokens: acc.totalTokens + p.totalTokens,
      cost: acc.cost + p.cost,
      saved: acc.saved + p.saved,
      requests: acc.requests + p.requests,
    }),
    { ...ZERO },
  );
}

export function combineTimeBuckets(perSource: AggregateBucket[][]): AggregateBucket[] {
  if (perSource.length === 0) return [];
  if (perSource.length === 1) return perSource[0];
  const merged = new Map<string, AggregateBucket>();
  for (const series of perSource) {
    for (const b of series) {
      const existing = merged.get(b.key);
      if (!existing) {

        merged.set(b.key, {
          ...b,
          models: cloneModelsMap(b.models),
        });
        continue;
      }
      existing.inputTokens += b.inputTokens;
      existing.outputTokens += b.outputTokens;
      existing.cacheReadTokens += b.cacheReadTokens;
      existing.cacheCreationTokens += b.cacheCreationTokens;
      existing.totalTokens += b.totalTokens;
      existing.cost += b.cost;
      existing.saved += b.saved;
      existing.requests += b.requests;
      for (const [modelName, m] of Object.entries(b.models)) {
        const cur = existing.models[modelName] ?? { tokens: 0, cost: 0, requests: 0 };
        cur.tokens += m.tokens;
        cur.cost += m.cost;
        cur.requests += m.requests;
        existing.models[modelName] = cur;
      }
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function cloneModelsMap(
  src: AggregateBucket['models'],
): AggregateBucket['models'] {
  const out: AggregateBucket['models'] = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = { tokens: v.tokens, cost: v.cost, requests: v.requests };
  }
  return out;
}
