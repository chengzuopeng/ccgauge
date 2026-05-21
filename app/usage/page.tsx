import { getCachedScan } from '@/lib/data-loader/scan';
import { aggregateByTime, aggregateTotals, isGranularity } from '@/lib/aggregator';
import { resolveCanonicalCwd } from '@/lib/project-label';
import { Section, PageShell, EmptyState } from '@/components/section';
import { TokenStackChart, type TokenStackDatum } from '@/components/charts/token-stack-chart';
import { UsageTable } from '@/components/usage-table';
import { recordsToTurnRows, type UsageTurnRow } from '@/lib/serialize';
import { RangePicker } from '@/components/range-picker';
import { normalizeUsageRange, rangeToDates } from '@/lib/range';
import { GranularityPicker } from '@/components/granularity-picker';
import { ModelFilter } from '@/components/model-filter';
import { ProjectFilter } from '@/components/project-filter';
import { KpiCard } from '@/components/kpi-card';
import { formatTokensCompact, formatUSD, formatPct } from '@/lib/utils';
import { getServerT } from '@/lib/i18n/server';
import { tFn } from '@/lib/i18n/dict';
import { getServerLocale } from '@/lib/i18n/server';
import { resolveSource, filterBySource, expandSources } from '@/lib/source';
import { combineTimeBuckets, combineTotals } from '@/lib/source-merge';
import { getProvider } from '@/lib/providers';
import { AutoRefresh } from '@/components/auto-refresh';
import { OverviewToggle } from '@/components/overview-toggle';
import {
  USAGE_PAGE_SIZE,
  isSortKey,
  parseUsagePageParam,
  type SortKey,
} from '@/lib/usage-query';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    // "Time" sort uses the turn's start timestamp — that's what the column
    // displays, so click-to-sort should be consistent with the visible value.
    const av = key === 'timestamp' ? a.timestamp : (a[key] as number);
    const bv = key === 'timestamp' ? b.timestamp : (b[key] as number);
    if (av === bv) return 0;
    return (dir === 'asc' ? 1 : -1) * (av < bv ? -1 : 1);
  });
  return arr;
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    range?: string;
    gran?: string;
    models?: string;
    projects?: string;
    q?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const source = await resolveSource(sp.source);
  const range = normalizeUsageRange(sp.range, '7d');
  const gran = isGranularity(sp.gran) ? sp.gran : range === '1d' ? 'hour' : 'day';
  const models = sp.models ? sp.models.split(',').filter(Boolean) : [];
  const projects = sp.projects ? sp.projects.split(',').filter(Boolean) : [];
  const query = (sp.q || '').trim();
  const sortKey: SortKey = sp.sort && isSortKey(sp.sort) ? sp.sort : 'timestamp';
  const sortDir: 'asc' | 'desc' = sp.dir === 'asc' ? 'asc' : 'desc';
  const pageNum = parseUsagePageParam(sp.page);

  const t = await getServerT();
  const locale = await getServerLocale();
  const scan = await getCachedScan();
  const allSourceRecords = filterBySource(scan.records, source);
  const allSourceUsers = filterBySource(scan.userRecords, source);
  const dates = rangeToDates(range);

  const sources = expandSources(source);

  // `projects` URL param holds **canonical** cwds (worktrees collapsed
  // to their main-repo path), matching the /projects page's grouping.
  // The aggregator's projects filter is exact-cwd, so we narrow records
  // here instead of passing the filter down — a single record with a
  // worktree cwd would otherwise miss a canonical-cwd selection.
  const projectsSet = new Set(projects);
  const projectFilteredRecords = projects.length
    ? allSourceRecords.filter((r) => projectsSet.has(resolveCanonicalCwd(r.cwd)))
    : allSourceRecords;

  // Run per-source then merge — `aggregateTotals` / `aggregateByTime`
  // require a concrete ProviderId, so the All view dispatches twice and
  // combines numeric results before they hit the KPI cards / chart.
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
  const trend: TokenStackDatum[] = buckets.map((b) => ({
    label: b.label,
    input: b.inputTokens,
    output: b.outputTokens,
    cacheRead: b.cacheReadTokens,
    cacheCreation: b.cacheCreationTokens,
    cost: b.cost,
    requests: b.requests,
  }));

  const filteredRecords = projectFilteredRecords.filter((r) => {
    if (dates.from && r.timestamp < dates.from.toISOString()) return false;
    if (models.length && !models.includes(r.model)) return false;
    return true;
  });

  const allTurns = recordsToTurnRows(filteredRecords, allSourceUsers, scan.parentMap);
  const searched = filterTurnsByQuery(allTurns, query);
  const sorted = sortTurns(searched, sortKey, sortDir);
  const totalCount = sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / USAGE_PAGE_SIZE));
  const safePage = Math.min(pageNum, pageCount - 1);
  const pageSlice = sorted.slice(safePage * USAGE_PAGE_SIZE, (safePage + 1) * USAGE_PAGE_SIZE);

  const allModels = Array.from(new Set(allSourceRecords.map((r) => r.model))).sort();
  // The ProjectFilter dropdown shows canonical (main-repo) cwds only —
  // worktrees collapse under their main project, just like /projects.
  const allProjects = Array.from(
    new Set(
      allSourceRecords
        .map((r) => resolveCanonicalCwd(r.cwd))
        .filter(Boolean),
    ),
  ).sort();

  const cacheHit =
    totals.totalTokens > 0
      ? totals.cacheReadTokens /
        Math.max(1, totals.cacheReadTokens + totals.inputTokens + totals.cacheCreationTokens)
      : 0;

  // Cost note is hidden in the All view (decided UX): the merged number
  // mixes Codex's "API equivalent" with Claude's API-exact value, so a
  // single footnote would be misleading either way.
  const costFootnote =
    source === 'all'
      ? ''
      : getProvider(source).costFootnoteKey
        ? t(getProvider(source).costFootnoteKey as string)
        : '';

  return (
    <PageShell
      title={t('usage.title')}
      desc={t('usage.subtitle', { count: totalCount.toLocaleString() })}
      right={
        <div className="flex items-center gap-3 flex-wrap">
          <OverviewToggle />
          <ModelFilter all={allModels} selected={models} />
          <ProjectFilter all={allProjects} selected={projects} />
          <RangePicker defaultValue="7d" />
        </div>
      }
    >
      <AutoRefresh intervalMs={15_000} />
      {allSourceRecords.length === 0 ? (
        <EmptyState title={t('common.empty.title')} desc={t('common.empty.desc')} />
      ) : (
        <>
          <div className="usage-overview-block contents">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <KpiCard label={t('usage.kpi.totalTokens')} value={formatTokensCompact(totals.totalTokens, locale)} />
              <KpiCard
                label={t('usage.kpi.totalCost')}
                value={formatUSD(totals.cost)}
                hint={costFootnote || undefined}
              />
              <KpiCard label={t('usage.kpi.cacheSaved')} value={formatUSD(totals.saved)} accent="success" />
              <KpiCard label={t('usage.kpi.cacheHit')} value={formatPct(cacheHit, 0)} accent="success" />
            </div>

            <Section
              title={t('usage.trend')}
              desc={t('usage.trend.gran', { gran: tFn(locale, `gran.${gran}`) })}
              right={<GranularityPicker defaultValue={gran} />}
              className="mt-4"
            >
              <TokenStackChart data={trend} />
            </Section>
          </div>

          <Section title={t('usage.requests.title')} desc={t('usage.requests.desc')}>
            <UsageTable
              rows={pageSlice}
              totalCount={totalCount}
              page={safePage}
              pageCount={pageCount}
              sort={{ key: sortKey, dir: sortDir }}
              query={query}
            />
          </Section>
        </>
      )}
    </PageShell>
  );
}
