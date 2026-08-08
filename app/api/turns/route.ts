import { NextResponse } from 'next/server';
import {
  aggregateByTime,
  aggregateTotals,
  isGranularity,
  type Granularity,
} from '@/lib/aggregator';
import { getAllModels, getAllProjects } from '@/lib/data-loader/derived';
import { expandSources } from '@/lib/source';
import { combineTotals, combineTimeBuckets } from '@/lib/source-merge';
import {
  USAGE_PAGE_SIZE,
  isSortKey,
  parseUsagePageParam,
  type SortKey,
} from '@/lib/usage-query';
import { badRequest, withApiErrorHandling } from '@/lib/api/error-handler';
import { parseTurnFilters, loadTurnScope } from '@/lib/api/turn-scope';
import { detectCodexFastTier } from '@/lib/providers/codex/speed';
import type { UsageTurnRow } from '@/lib/serialize';

/**
 * /api/turns — the data island feed for the /usage page.
 *
 * Returns everything the page needs (totals, trend buckets, paginated turns,
 * filter dropdown contents) as ~20KB JSON instead of the ~300KB HTML the
 * page used to ship per navigation. Switching range/source/model now only
 * costs an API roundtrip; the page shell stays mounted, so React can update
 * just the data island.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function filterTurnsByQuery(turns: UsageTurnRow[], q: string): UsageTurnRow[] {
  if (!q) return turns;
  const needle = q.toLowerCase();
  return turns.filter(
    (t) =>
      t.userText.toLowerCase().includes(needle) ||
      t.cwd.toLowerCase().includes(needle) ||
      t.sessionId.toLowerCase().includes(needle) ||
      t.models.some((m) => m.toLowerCase().includes(needle)) ||
      t.toolNames.some((tool) => tool.toLowerCase().includes(needle)),
  );
}

function sortTurns(turns: UsageTurnRow[], key: SortKey, dir: 'asc' | 'desc'): UsageTurnRow[] {
  const arr = turns.slice();
  arr.sort((a, b) => {
    const av = key === 'timestamp' ? a.timestamp : (a[key] as number);
    const bv = key === 'timestamp' ? b.timestamp : (b[key] as number);
    if (av === bv) return 0;
    return (dir === 'asc' ? 1 : -1) * (av < bv ? -1 : 1);
  });
  return arr;
}

export const GET = withApiErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const parsed = await parseTurnFilters(sp);
  if ('error' in parsed) return parsed.error;
  const { source, range, dates, models, projects } = parsed.filters;

  const granRaw = sp.get('gran') || (range === '1d' ? 'hour' : 'day');
  if (!isGranularity(granRaw)) {
    return badRequest(`invalid granularity: ${granRaw}`, 'invalid_granularity');
  }
  const gran = granRaw as Granularity;

  const query = (sp.get('q') || '').trim();
  const sortRaw = sp.get('sort') || 'timestamp';
  const sortKey: SortKey = isSortKey(sortRaw) ? sortRaw : 'timestamp';
  const sortDir: 'asc' | 'desc' = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const pageNum = parseUsagePageParam(sp.get('page'));

  const { allSourceRecords, projectFilteredRecords, allTurns } = await loadTurnScope(
    parsed.filters,
  );

  const sources = expandSources(source);

  const baseOpts = {
    from: dates.from,
    to: dates.to,
    models: models.length ? models : undefined,
  };

  const totals = combineTotals(
    sources.map((s) => aggregateTotals(projectFilteredRecords, { ...baseOpts, source: s })),
  );

  const buckets = combineTimeBuckets(
    sources.map((s) => aggregateByTime(projectFilteredRecords, gran, { ...baseOpts, source: s })),
  );
  const trend = buckets.map((b) => ({
    label: b.label,
    input: b.inputTokens,
    output: b.outputTokens,
    cacheRead: b.cacheReadTokens,
    cacheCreation: b.cacheCreationTokens,
    cost: b.cost,
    requests: b.requests,
  }));

  const searched = filterTurnsByQuery(allTurns, query);
  const sorted = sortTurns(searched, sortKey, sortDir);
  const totalCount = sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / USAGE_PAGE_SIZE));
  const safePage = Math.min(pageNum, pageCount - 1);
  // `children` — every API call of the turn — is 99.5% of this payload and is
  // needed only once a row is expanded. Measured before it was dropped: 9.29MB
  // for a page of 25, one turn alone 4MB / 3498 calls, and the client spent
  // 0.9s parsing it on every filter click. /api/turns/children serves it per
  // turn, on demand, paginated. Copied rather than deleted in place: these rows
  // come straight out of the shared LRU.
  const pageSlice = sorted
    .slice(safePage * USAGE_PAGE_SIZE, (safePage + 1) * USAGE_PAGE_SIZE)
    .map(({ children: _children, ...rest }) => rest);

  const allModels = getAllModels(allSourceRecords);
  const allProjects = getAllProjects(allSourceRecords);

  return NextResponse.json({
    source,
    range,
    gran,
    totals,
    trend,
    turns: pageSlice,
    totalCount,
    pageCount,
    page: safePage,
    sort: { key: sortKey, dir: sortDir },
    query,
    models,
    projects,
    allModels,
    allProjects,
    // Read fresh per request so the dashboard reflects live config.toml edits
    // without a restart (the old module-level cache was the v1.2.0 staleness bug).
    codexFastActive: detectCodexFastTier(),
    hasAnyRecords: allSourceRecords.length > 0,
  });
});
