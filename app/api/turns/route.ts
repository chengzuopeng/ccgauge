import { NextResponse } from 'next/server';
import { getCachedScan } from '@/lib/data-loader/scan';
import {
  aggregateByTime,
  aggregateTotals,
  isGranularity,
  type Granularity,
} from '@/lib/aggregator';
import {
  recordsToTurnRowsCached,
  getAllModels,
  getAllProjects,
} from '@/lib/data-loader/derived';
import {
  isUsageRange,
  rangeToDates,
  parseCustomRange,
  type UsageRange,
} from '@/lib/range';
import { resolveSource, filterBySource, expandSources } from '@/lib/source';
import { combineTotals, combineTimeBuckets } from '@/lib/source-merge';
import { resolveCanonicalCwd } from '@/lib/project-label';
import {
  USAGE_PAGE_SIZE,
  isSortKey,
  parseUsagePageParam,
  type SortKey,
} from '@/lib/usage-query';
import { badRequest, withApiErrorHandling } from '@/lib/api/error-handler';
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

  const source = await resolveSource(sp.get('source'));

  const rangeRaw = sp.get('range') || '7d';
  if (!isUsageRange(rangeRaw)) {
    return badRequest(`invalid range: ${rangeRaw}`, 'invalid_range');
  }
  const range = rangeRaw as UsageRange;
  let dates: { from?: Date; to?: Date };
  if (range === 'custom') {
    dates = parseCustomRange(sp.get('from'), sp.get('to'));
    if (!dates.from) {
      return badRequest(
        'range=custom requires a valid `from` (YYYY-MM-DD)',
        'invalid_custom_range',
      );
    }
  } else {
    dates = rangeToDates(range);
  }

  const granRaw = sp.get('gran') || (range === '1d' ? 'hour' : 'day');
  if (!isGranularity(granRaw)) {
    return badRequest(`invalid granularity: ${granRaw}`, 'invalid_granularity');
  }
  const gran = granRaw as Granularity;

  const models = sp.get('models')?.split(',').filter(Boolean) ?? [];
  const projects = sp.get('projects')?.split(',').filter(Boolean) ?? [];
  const query = (sp.get('q') || '').trim();
  const sortRaw = sp.get('sort') || 'timestamp';
  const sortKey: SortKey = isSortKey(sortRaw) ? sortRaw : 'timestamp';
  const sortDir: 'asc' | 'desc' = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const pageNum = parseUsagePageParam(sp.get('page'));

  const scan = await getCachedScan();
  const allSourceRecords = filterBySource(scan.records, source);
  const allSourceUsers = filterBySource(scan.userRecords, source);

  const sources = expandSources(source);

  const projectsSet = new Set(projects);
  const projectFilteredRecords = projects.length
    ? allSourceRecords.filter((r) => projectsSet.has(resolveCanonicalCwd(r.cwd)))
    : allSourceRecords;

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

  const fromIso = dates.from ? dates.from.toISOString() : '';
  const toIso = dates.to ? dates.to.toISOString() : '';
  const filteredRecords = projectFilteredRecords.filter((r) => {
    if (dates.from && r.timestamp < fromIso) return false;
    if (dates.to && r.timestamp > toIso) return false;
    if (models.length && !models.includes(r.model)) return false;
    return true;
  });

  // Cache key uses the range TOKEN (not the resolved fromIso/toIso) so 7d /
  // 30d / 90d hit the same cache entry on every request — `rangeToDates`
  // recomputes `now - Nd` per call, which would otherwise drift the key. For
  // `custom`, we include the explicit from/to since those ARE stable.
  const customStamp = range === 'custom' ? `${fromIso}~${toIso}` : '';
  const filterKey = [
    source,
    range,
    customStamp,
    models.slice().sort().join(','),
    projects.slice().sort().join(','),
  ].join('|');

  const allTurns = recordsToTurnRowsCached(
    scan,
    filterKey,
    filteredRecords,
    allSourceUsers,
    scan.parentMap,
  );
  const searched = filterTurnsByQuery(allTurns, query);
  const sorted = sortTurns(searched, sortKey, sortDir);
  const totalCount = sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / USAGE_PAGE_SIZE));
  const safePage = Math.min(pageNum, pageCount - 1);
  const pageSlice = sorted.slice(safePage * USAGE_PAGE_SIZE, (safePage + 1) * USAGE_PAGE_SIZE);

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
    codexFastActive: detectCodexFastTier(),
    hasAnyRecords: allSourceRecords.length > 0,
  });
});
