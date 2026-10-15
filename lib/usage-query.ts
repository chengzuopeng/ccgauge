import type { UsageTurnRow } from './serialize';

export const USAGE_PAGE_SIZE = 25;

export const SORT_KEYS = [
  'timestamp',
  'cost',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'totalTokens',
  'callCount',
  'durationMs',
  'outputSpeed',
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && (SORT_KEYS as readonly string[]).includes(v);
}

export function parseUsagePageParam(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.floor(n) - 1;
}

export function sortTurns(turns: UsageTurnRow[], key: SortKey, dir: 'asc' | 'desc'): UsageTurnRow[] {
  const arr = turns.slice();
  arr.sort((a, b) => {
    const av = key === 'timestamp' ? a.timestamp : (a[key] as number | null);
    const bv = key === 'timestamp' ? b.timestamp : (b[key] as number | null);
    if (av === bv) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (dir === 'asc' ? 1 : -1) * (av < bv ? -1 : 1);
  });
  return arr;
}
