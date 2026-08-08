'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT, useI18n } from '@/lib/i18n/context';
import { tFn } from '@/lib/i18n/dict';
import { Section, EmptyState } from '@/components/section';
import { KpiCard } from '@/components/kpi-card';
import { TokenStackChart, type TokenStackDatum } from '@/components/charts/token-stack-chart';
import { UsageTable } from '@/components/usage-table';
import { GranularityPicker } from '@/components/granularity-picker';
import { formatTokensCompact, formatUSD, formatPct } from '@/lib/utils';
import { type SortKey } from '@/lib/usage-query';
import type { UsageTurnSummary } from '@/lib/serialize';

/**
 * Client data-island for /usage. Subscribes to URL search params and fetches
 * `/api/turns` whenever they change. A tiny stale-while-revalidate cache
 * keyed by URL keeps back-and-forth navigation (7d ↔ 30d, source toggles)
 * snappy: old data stays on screen while the fresh fetch arrives, so the
 * page never goes blank.
 *
 * The shell (PageShell, RangePicker, source switcher, search input) stays
 * mounted in the parent server page — only this island re-renders on filter
 * changes, slashing per-nav payload from ~300KB HTML to ~20KB JSON.
 */

interface TurnsPayload {
  totals: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    cost: number;
    saved: number;
  };
  trend: TokenStackDatum[];
  turns: UsageTurnSummary[];
  totalCount: number;
  pageCount: number;
  page: number;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  query: string;
  models: string[];
  projects: string[];
  allModels: string[];
  allProjects: string[];
  codexFastActive: boolean;
  hasAnyRecords: boolean;
  range: string;
  gran: string;
}

// Module-level cache survives unmount; reset only when the page reloads. Bounded
// because it never used to be: one entry per distinct filter URL, each a full
// payload, retained for the life of the tab. Map iteration order is insertion
// order, so evicting the first key is LRU as long as every read re-inserts.
const CACHE_MAX = 12;
const cache = new Map<string, TurnsPayload>();

function cacheGet(url: string): TurnsPayload | undefined {
  const hit = cache.get(url);
  if (!hit) return undefined;
  cache.delete(url);
  cache.set(url, hit);
  return hit;
}

function cacheSet(url: string, payload: TurnsPayload): void {
  cache.delete(url);
  cache.set(url, payload);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

interface InitialBundle {
  payload: TurnsPayload;
  url: string;
}

interface Props {
  initial?: InitialBundle;
  costFootnote?: string;
}

export function UsageDataIsland({ initial, costFootnote }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const sp = useSearchParams();

  // Seed the cache with whatever the server-rendered shell handed us.
  if (initial && !cache.has(initial.url)) cacheSet(initial.url, initial.payload);

  const url = useMemo(() => buildUrl(sp.toString()), [sp]);

  const [data, setData] = useState<TurnsPayload | null>(() => cacheGet(url) ?? null);
  const [loading, setLoading] = useState(!cache.has(url));
  const [error, setError] = useState<string | null>(null);
  // Bumped by the auto-refresh tick to re-run the fetch below. It used to fire
  // its OWN fetch and bump `reqId` first, which made every tick cancel whatever
  // request was in flight — including the one a filter click had just started.
  // The click's response was then dropped on the floor and the table sat
  // unchanged until the NEXT tick's fetch landed, so 10 of 12 measured clicks
  // froze for up to 16.5s, always unfreezing on a 15s boundary. One request
  // pipeline, one counter: a refresh can no longer outrank a newer navigation.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    const my = ++reqId.current;
    const cached = cacheGet(url);
    if (cached) {
      // SWR: render cached immediately, refetch silently.
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TurnsPayload>;
      })
      .then((payload) => {
        if (my !== reqId.current) return; // a newer fetch superseded
        cacheSet(url, payload);
        setData(payload);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (my !== reqId.current) return;
        setError(err.message);
        setLoading(false);
      });
  }, [url, refreshNonce]);

  // Allow external triggers (AutoRefresh) to bust the cache. Drops only the
  // current URL's entry — clearing the whole map threw away every other filter
  // combo the user might navigate back to.
  useEffect(() => {
    function onRefresh() {
      cache.delete(url);
      setRefreshNonce((n) => n + 1);
    }
    window.addEventListener('ccgauge:refresh', onRefresh);
    return () => window.removeEventListener('ccgauge:refresh', onRefresh);
  }, [url]);

  if (!data) {
    if (error) {
      return (
        <div className="card mt-4 p-6 text-sm text-warning">
          {t('common.empty.title')}: {error}
        </div>
      );
    }
    return <IslandSkeleton />;
  }

  if (!data.hasAnyRecords) {
    return <EmptyState title={t('common.empty.title')} desc={t('common.empty.desc')} />;
  }

  const cacheHit =
    data.totals.totalTokens > 0
      ? data.totals.cacheReadTokens /
        Math.max(
          1,
          data.totals.cacheReadTokens +
            data.totals.inputTokens +
            data.totals.cacheCreationTokens,
        )
      : 0;

  return (
    <div className={loading ? 'opacity-90' : ''} aria-busy={loading}>
      <div className="usage-overview-block grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <KpiCard label={t('usage.kpi.totalTokens')} value={formatTokensCompact(data.totals.totalTokens, locale)} />
        <KpiCard
          label={t('usage.kpi.totalCost')}
          value={formatUSD(data.totals.cost)}
          hint={costFootnote || undefined}
        />
        <KpiCard label={t('usage.kpi.cacheSaved')} value={formatUSD(data.totals.saved)} accent="success" />
        <KpiCard label={t('usage.kpi.cacheHit')} value={formatPct(cacheHit, 0)} accent="success" />
      </div>

      <Section
        title={t('usage.trend')}
        desc={t('usage.trend.gran', { gran: tFn(locale, `gran.${data.gran}`) })}
        right={<GranularityPicker defaultValue={data.gran} />}
        className="usage-overview-block mt-4"
      >
        <TokenStackChart data={data.trend} />
      </Section>

      <Section title={t('usage.requests.title')} desc={t('usage.requests.desc')} className="mt-4">
        <UsageTable
          rows={data.turns}
          totalCount={data.totalCount}
          page={data.page}
          pageCount={data.pageCount}
          sort={data.sort}
          query={data.query}
          codexFastActive={data.codexFastActive}
        />
      </Section>
    </div>
  );
}

export function IslandSkeleton() {
  return (
    <div>
      <div className="usage-overview-block grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4">
            <div className="h-3 w-24 rounded bg-bg-surface-hi/40 animate-pulse" />
            <div className="h-7 w-28 mt-3 rounded bg-bg-surface-hi/60 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="usage-overview-block card mt-4 h-72 bg-bg-surface-hi/30 animate-pulse" />
      <div className="card mt-4 p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-7 rounded bg-bg-surface-hi/40 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function buildUrl(qs: string): string {
  return qs ? `/api/turns?${qs}` : '/api/turns';
}
