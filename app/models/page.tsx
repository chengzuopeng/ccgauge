import { getCachedScan } from '@/lib/data-loader/scan';
import { aggregateByModel, aggregateByTime } from '@/lib/aggregator';
import { Section, PageShell, EmptyState } from '@/components/section';
import { TokenStackChart, type TokenStackDatum } from '@/components/charts/token-stack-chart';
import { formatTokensCompact, formatUSD, formatPct } from '@/lib/utils';
import { getServerT, getServerLocale } from '@/lib/i18n/server';
import { resolveSource, filterBySource, expandSources } from '@/lib/source';
import { combineTimeBuckets } from '@/lib/source-merge';
import { getProvider } from '@/lib/providers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const sp = await searchParams;
  const source = await resolveSource(sp.source);
  const t = await getServerT();
  const locale = await getServerLocale();
  const scan = await getCachedScan();
  const records = filterBySource(scan.records, source);
  const sources = expandSources(source);

  const shortenFor = (m: { source: typeof sources[number]; model: string }) =>
    getProvider(m.source).shortenModel(m.model);

  if (records.length === 0) {
    return (
      <PageShell title={t('models.title')}>
        <EmptyState title={t('models.empty')} />
      </PageShell>
    );
  }

  const models = sources
    .flatMap((s) => aggregateByModel(records, { source: s }))
    .sort((a, b) => b.cost - a.cost);
  const total = models.reduce((s, m) => s + m.cost, 0);
  const totalTokens = models.reduce((s, m) => s + m.totalTokens, 0);

  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const trendBuckets = combineTimeBuckets(
    sources.map((s) => aggregateByTime(records, 'day', { source: s, from: thirtyAgo })),
  );
  const trend: TokenStackDatum[] = trendBuckets.map((b) => ({
    label: b.label,
    input: b.inputTokens,
    output: b.outputTokens,
    cacheRead: b.cacheReadTokens,
    cacheCreation: b.cacheCreationTokens,
    cost: b.cost,
    requests: b.requests,
  }));

  return (
    <PageShell title={t('models.title')} desc={t('models.subtitle', { count: models.length })}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {models.map((m) => {
          const costPct = total > 0 ? m.cost / total : 0;
          const tokenPct = totalTokens > 0 ? m.totalTokens / totalTokens : 0;
          const cacheHit =
            m.totalTokens > 0
              ? m.cacheReadTokens / Math.max(1, m.cacheReadTokens + m.inputTokens + m.cacheCreationTokens)
              : 0;
          return (

            <div key={`${m.source}:${m.model}`} className="card card-pad space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="font-semibold text-text-primary flex items-center gap-2">
                    <span>{shortenFor(m)}</span>
                    {source === 'all' && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-tertiary font-medium">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={getProvider(m.source).logoSrc}
                          alt=""
                          aria-hidden
                          className="w-3.5 h-3.5 rounded-[3px] object-contain"
                        />
                        {m.source === 'claude' ? 'Claude' : 'Codex'}
                      </span>
                    )}
                  </div>
                  <div className="num-mono text-xs text-text-tertiary">{m.model}</div>
                </div>
                {!m.pricingResolved && (
                  <span className="pill bg-warning/10 text-warning border border-warning/20 text-[10px] whitespace-nowrap">
                    {t('common.fallbackPrice')}
                  </span>
                )}
              </div>
              <div className="num-hero">{formatUSD(m.cost)}</div>
              <div className="text-xs text-text-secondary">
                {t('models.field.pctOfTotal', {
                  pct: formatPct(costPct, 0),
                  tokens: formatTokensCompact(m.totalTokens, locale),
                })}
              </div>
              <ProgressRow label={t('models.share.cost')} value={costPct} tone="brand" right={formatPct(costPct)} />
              <ProgressRow label={t('models.share.tokens')} value={tokenPct} tone="default" right={formatPct(tokenPct)} />
              <ProgressRow label={t('models.share.cacheHit')} value={cacheHit} tone="success" right={formatPct(cacheHit, 0)} />
              <div className="pt-3 border-t border-border grid grid-cols-2 gap-2 text-xs">
                <div className="text-text-tertiary">{t('models.field.requests')}</div>
                <div className="num-mono text-right text-text-primary">{m.requests}</div>
                <div className="text-text-tertiary">{t('models.field.savedByCache')}</div>
                <div className="num-mono text-right text-success">{formatUSD(m.saved)}</div>
                {m.pricing && (
                  <>
                    <div className="text-text-tertiary">{t('models.field.input1M')}</div>
                    <div className="num-mono text-right text-text-secondary">{formatUSD(m.pricing.input)}</div>
                    <div className="text-text-tertiary">{t('models.field.output1M')}</div>
                    <div className="num-mono text-right text-text-secondary">{formatUSD(m.pricing.output)}</div>
                    <div className="text-text-tertiary">{t('models.field.cacheRead1M')}</div>
                    <div className="num-mono text-right text-text-secondary">{formatUSD(m.pricing.cacheRead)}</div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Section title={t('models.eachTrend')}>
        <TokenStackChart data={trend} />
      </Section>
    </PageShell>
  );
}

function ProgressRow({
  label,
  value,
  right,
  tone = 'default',
}: {
  label: string;
  value: number;
  right?: string;
  tone?: 'brand' | 'success' | 'default';
}) {
  const colorMap = {
    brand: 'bg-brand',
    success: 'bg-success',
    default: 'bg-chart-input',
  } as const;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-tertiary">{label}</span>
        <span className="num-mono text-text-secondary">{right}</span>
      </div>
      <div className="h-1 bg-bg-surface-hi rounded mt-1 overflow-hidden">
        <div
          className={`h-full ${colorMap[tone]} rounded`}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </div>
    </div>
  );
}
