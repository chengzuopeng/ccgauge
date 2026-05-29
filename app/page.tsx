import { getCachedScan } from '@/lib/data-loader/scan';
import { aggregateByModel, aggregateByTime, aggregateTotals, bucketKey } from '@/lib/aggregator';
import { buildTurnIndex } from '@/lib/turns';
import { blockProgress } from '@/lib/blocks/compute';
import { KpiCard } from '@/components/kpi-card';
import { Section, PageShell, EmptyState } from '@/components/section';
import { type TokenStackDatum } from '@/components/charts/token-stack-chart';
import { ModelBarChart } from '@/components/charts/model-bar-chart';
import { BlockProgress } from '@/components/block-progress';
import { BlockProgressSwitcher } from '@/components/block-progress-switcher';
import { OverviewTrendCard } from '@/components/overview-trend-card';
import { blockToSerialized } from '@/lib/serialize';
import {
  formatTokensCompact,
  formatUSD,
  formatPct,
} from '@/lib/utils';
import { getServerT, getServerLocale } from '@/lib/i18n/server';
import { resolveSource, filterBySource, expandSources, type EffectiveSource } from '@/lib/source';
import { combineTimeBuckets, combineTotals } from '@/lib/source-merge';
import { getProvider } from '@/lib/providers';
import { computeActivityStats, pickTokenComparison } from '@/lib/aggregator/activity';
import { ActivityStatsSection } from '@/components/activity-stats';
import { AutoRefresh } from '@/components/auto-refresh';
import type { ModelSummary, ProviderId } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isToday(ts: string): boolean {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isYesterday(ts: string): boolean {
  const d = new Date(ts);
  const ref = new Date();
  ref.setDate(ref.getDate() - 1);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function isThisMonth(ts: string): boolean {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const sp = await searchParams;
  const source = await resolveSource(sp.source);
  return <OverviewContent source={source} />;
}

async function OverviewContent({ source }: { source: EffectiveSource }) {
  const scan = await getCachedScan();
  // For 'all', this is a pass-through (no source filter); for a single
  // provider it narrows to that provider's records.
  const records = filterBySource(scan.records, source);
  const sources = expandSources(source);

  const t = await getServerT();
  const locale = await getServerLocale();
  const fmtTokens = (n: number) => formatTokensCompact(n, locale);
  // For "Top model" label rendering we need to pick the right provider's
  // shortener — the model entry carries its own `source` so we look it up
  // per row instead of relying on a single provider here.
  const shorten = (m: ModelSummary) => getProvider(m.source).shortenModel(m.model);

  if (records.length === 0) {
    return (
      <PageShell title={t('overview.title')} desc={t('brand.tagline')}>
        {/* Keep the auto-refresh ticking even in the empty state — the
            first session a new user creates after launching ccgauge
            should appear without a manual reload. */}
        <AutoRefresh intervalMs={30_000} />
        <EmptyState
          title={t('overview.empty.title')}
          desc={t('overview.subtitle.empty', { dirs: scan.stats.scannedDirs.length })}
        />
      </PageShell>
    );
  }

  const todayRecs = records.filter((r) => isToday(r.timestamp));
  const yesterdayRecs = records.filter((r) => isYesterday(r.timestamp));
  const monthRecs = records.filter((r) => isThisMonth(r.timestamp));

  // Dispatch per source then merge — keeps the aggregator's single-source
  // contract intact while letting the All view sum across providers.
  const today = combineTotals(sources.map((s) => aggregateTotals(todayRecs, { source: s })));
  const yest = combineTotals(sources.map((s) => aggregateTotals(yesterdayRecs, { source: s })));
  const month = combineTotals(sources.map((s) => aggregateTotals(monthRecs, { source: s })));

  const hasYesterday = yest.totalTokens > 0 || yest.cost > 0;
  const tokenDelta = yest.totalTokens > 0 ? ((today.totalTokens - yest.totalTokens) / yest.totalTokens) * 100 : NaN;
  const firstTimeDelta = !hasYesterday && (today.totalTokens > 0 || today.cost > 0)
    ? { firstTime: true as const, label: t('overview.delta.firstTime') }
    : null;

  const cacheHit =
    today.cacheReadTokens + today.inputTokens > 0
      ? today.cacheReadTokens / (today.cacheReadTokens + today.inputTokens + today.cacheCreationTokens)
      : 0;

  // Each provider's 5-hour block is a separate rate-limit window
  // (Anthropic vs OpenAI). For 'all' we compute both and render side by
  // side; for a single provider we render the original single card.
  const blocksBySource: Array<{ source: ProviderId; serialized: ReturnType<typeof blockToSerialized> }> = sources.map(
    (s) => {
      const provider = getProvider(s);
      const recs = source === 'all' ? records.filter((r) => r.source === s) : records;
      const block = blockProgress(recs, provider.capabilities.blockWindowMs);
      return { source: s, serialized: blockToSerialized(block) };
    },
  );

  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  // Run the time aggregator per source, then merge buckets so same-day
  // cells get the sum across providers.
  const trendBuckets = combineTimeBuckets(
    sources.map((s) => aggregateByTime(records, 'day', { source: s, from: thirtyAgo })),
  );

  // Count conversations (= usage-table rows) per day. A "conversation" is
  // a turn: every assistant record is mapped to its turn root via the
  // parent chain (skipping synthetic user records), then we group records
  // by turn root and attribute the whole turn to the day of its earliest
  // record. This matches what the usage table shows when rows are
  // collapsed — one row per user prompt regardless of how many API calls
  // it triggered.
  const fromIso = thirtyAgo.toISOString();
  const scopedRecords = records.filter((r) => r.timestamp >= fromIso);
  const scopedUsers = filterBySource(scan.userRecords, source).filter(
    (u) => u.timestamp >= fromIso,
  );
  const turnIndex = buildTurnIndex(scopedRecords, scopedUsers, scan.parentMap);
  const turnStartTs = new Map<string, string>();
  for (const r of scopedRecords) {
    const turnId = turnIndex.get(r.uuid) ?? r.uuid;
    const existing = turnStartTs.get(turnId);
    if (!existing || r.timestamp < existing) turnStartTs.set(turnId, r.timestamp);
  }
  const turnsByBucket = new Map<string, number>();
  for (const ts of turnStartTs.values()) {
    const { key } = bucketKey(ts, 'day');
    turnsByBucket.set(key, (turnsByBucket.get(key) ?? 0) + 1);
  }

  const trendData: TokenStackDatum[] = trendBuckets.map((b) => ({
    label: b.label,
    input: b.inputTokens,
    output: b.outputTokens,
    cacheRead: b.cacheReadTokens,
    cacheCreation: b.cacheCreationTokens,
    cost: b.cost,
    requests: b.requests,
    turns: turnsByBucket.get(b.key) ?? 0,
  }));

  const activeDays = trendBuckets.length;
  const activeDaysHint =
    activeDays === 1
      ? t('overview.trend.activeDays', { n: 1 })
      : t('overview.trend.activeDays.plural', { n: activeDays });

  // Models: Claude and Codex model names are disjoint, so a flatMap+sort
  // works without merging by name.
  const monthModelsAllSources = sources
    .flatMap((s) => aggregateByModel(records, { source: s, from: startOfMonth() }))
    .sort((a, b) => b.cost - a.cost);
  const topModel = monthModelsAllSources[0];
  const topModelPct =
    topModel && month.cost > 0 ? formatPct(topModel.cost / month.cost) : '—';

  // Use the active source's stats for the overview header. For All, sum
  // across the source breakdown so file/record counts reflect the merged
  // view rather than just one provider.
  const sourceFileCount =
    source === 'all'
      ? scan.bySource.reduce((sum, s) => sum + s.filesScanned, 0)
      : (scan.bySource.find((s) => s.source === source)?.filesScanned ?? 0);
  const sourceRecordCount =
    source === 'all'
      ? scan.bySource.reduce((sum, s) => sum + s.assistantRecords, 0)
      : (scan.bySource.find((s) => s.source === source)?.assistantRecords ?? records.length);

  return (
    <PageShell
      title={t('overview.title')}
      desc={t('overview.subtitle', {
        count: sourceRecordCount.toLocaleString(),
        files: sourceFileCount,
        ms: scan.stats.durationMs,
      })}
    >
      {/* Silent 30s background refresh — re-streams the server tree so
          all KPIs / charts / the 5h block update in place without
          remounting the page or losing scroll position. Paused while
          the tab is hidden. /usage uses the same component at 15s
          since its turn-grouped table changes more often. */}
      <AutoRefresh intervalMs={30_000} />
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t('overview.kpi.tokensToday')}
          value={fmtTokens(today.totalTokens)}
          hint={t('overview.kpi.tokensToday.hint', { count: today.requests })}
          delta={Number.isFinite(tokenDelta) ? { value: tokenDelta, positiveIsGood: false } : firstTimeDelta}
          deltaTitle={t('overview.delta.title')}
        />
        <KpiCard
          label={t('overview.kpi.thisMonth')}
          value={formatUSD(month.cost)}
          hint={t('overview.kpi.thisMonth.hint', {
            tokens: fmtTokens(month.totalTokens),
            req: month.requests,
          })}
        />
        <KpiCard
          label={t('overview.kpi.cacheHit')}
          value={formatPct(cacheHit, 0)}
          hint={t('overview.kpi.cacheHit.hint', { amount: formatUSD(today.saved) })}
          accent="success"
          progress={{ value: cacheHit, tone: 'success' }}
        />
        <KpiCard
          label={t('overview.kpi.topModel')}
          value={topModel ? shorten(topModel) : '—'}
          hint={topModel ? t('overview.kpi.topModel.hint', { pct: topModelPct }) : ''}
          accent="brand"
        />
      </div>

      <OverviewTrendCard data={trendData} activeDaysHint={activeDaysHint} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div className="lg:col-span-2 flex">
          <ActivityStatsSection
            stats={computeActivityStats(records, { source })}
            comparison={pickTokenComparison(
              records.reduce(
                (s, r) =>
                  s +
                  r.usage.input_tokens +
                  r.usage.output_tokens +
                  r.usage.cache_read_input_tokens +
                  r.usage.cache_creation_input_tokens,
                0,
              ),
            )}
            locale={locale}
            className="flex-1"
          />
        </div>
        <div className="flex">
          {source === 'all' && blocksBySource.length > 1 ? (
            // Single card + a small switcher on top. We don't show both
            // blocks at once — the 5-hour windows are per-provider, can't
            // be summed, and the user usually only cares about whichever
            // is currently active. Default selection picks the busier
            // provider so the card lands on the more interesting block.
            <BlockProgressSwitcher
              slots={blocksBySource.map((b) => ({
                source: b.source,
                label: b.source === 'claude' ? 'Claude' : 'Codex',
                cliName: b.source === 'claude' ? 'Claude Code' : 'Codex CLI',
                initial: b.serialized,
              }))}
              defaultSource={pickBusierBlock(blocksBySource)}
              className="flex-1"
            />
          ) : (
            <BlockProgress
              initial={blocksBySource[0].serialized}
              cliName={blocksBySource[0].source === 'claude' ? 'Claude Code' : 'Codex CLI'}
              className="flex-1"
            />
          )}
        </div>
      </div>

      <Section title={t('overview.costByModel.title')} desc={t('overview.costByModel.desc')}>
        <ModelBarChart models={monthModelsAllSources.slice(0, 8)} />
      </Section>
    </PageShell>
  );
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Choose which provider's block to surface first on the All view.
 *
 *  Priority:
 *    1. If only one provider has an active block, pick that one — the
 *       other side shows an empty state, no point defaulting to it.
 *    2. If both have active blocks, pick whichever spent more in USD —
 *       cost normalises across providers (raw tokens favour Claude due
 *       to its huge cache reads).
 *    3. If neither has an active block, pick the first provider as a
 *       deterministic fallback (the user can still toggle). */
function pickBusierBlock(
  blocks: Array<{ source: ProviderId; serialized: ReturnType<typeof blockToSerialized> }>,
): ProviderId {
  if (blocks.length === 0) return 'claude';
  const withActive = blocks.filter((b) => b.serialized.hasBlock);
  if (withActive.length === 1) return withActive[0].source;
  const pool = withActive.length > 0 ? withActive : blocks;
  let best = pool[0];
  for (const b of pool) {
    if (b.serialized.cost > best.serialized.cost) best = b;
  }
  return best.source;
}
