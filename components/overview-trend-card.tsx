'use client';

import { useState } from 'react';
import { Section } from '@/components/section';
import { TokenStackChart, type TokenStackDatum } from '@/components/charts/token-stack-chart';
import { ConversationsBarChart } from '@/components/charts/conversations-bar-chart';
import { useT } from '@/lib/i18n/context';
import { useTabIndicator } from '@/components/use-tab-indicator';

type Metric = 'tokens' | 'conversations';

interface Props {
  data: TokenStackDatum[];
  /** Pre-localized hint about how many days in the window have data
   *  (e.g. "25 天有数据"). Computed server-side because the active-day
   *  count comes from the raw record set, not the chart payload. */
  activeDaysHint: string;
}

/** The overview "Usage trend" card. Wraps the title + right-slot
 *  controls so the metric toggle can drive both the chart and the
 *  description on the client without a round-trip. */
export function OverviewTrendCard({ data, activeDaysHint }: Props) {
  const t = useT();
  const [metric, setMetric] = useState<Metric>('tokens');
  const metricLabel = t(
    metric === 'tokens' ? 'overview.trend.desc.tokens' : 'overview.trend.desc.conversations',
  );
  return (
    <Section
      title={t('overview.trend.title')}
      desc={t('overview.trend.desc', { metric: metricLabel })}
      right={
        <div className="flex items-center gap-3">
          <MetricToggle value={metric} onChange={setMetric} />
          <span className="text-xs text-text-tertiary whitespace-nowrap">{activeDaysHint}</span>
        </div>
      }
    >
      {metric === 'tokens' ? (
        <TokenStackChart data={data} />
      ) : (
        <ConversationsBarChart data={data} />
      )}
    </Section>
  );
}

function MetricToggle({
  value,
  onChange,
}: {
  value: Metric;
  onChange: (m: Metric) => void;
}) {
  const t = useT();
  const opts: Array<{ id: Metric; labelKey: string }> = [
    { id: 'tokens', labelKey: 'overview.trend.metric.tokens' },
    { id: 'conversations', labelKey: 'overview.trend.metric.conversations' },
  ];
  const { containerRef, rect } = useTabIndicator<HTMLDivElement>(value);
  const showFallback = rect === null;
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-bg-surface p-0.5">
      <div ref={containerRef} role="tablist" aria-label={t('overview.trend.title')} className="relative flex gap-0.5">
        {rect && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 rounded bg-brand-strong shadow-sm transition-[transform,width] duration-200 ease-out-soft"
            style={{ transform: `translateX(${rect.left}px)`, width: rect.width }}
          />
        )}
        {opts.map((o) => {
          const isActive = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="tab"
              data-tab={o.id}
              aria-selected={isActive}
              onClick={() => onChange(o.id)}
              className={`relative z-10 px-2.5 h-6 text-xs inline-flex items-center rounded transition-colors ${
                isActive
                  ? `text-white font-semibold ${showFallback ? 'bg-brand-strong shadow-sm' : ''}`
                  : 'text-text-tertiary font-medium hover:text-text-primary hover:bg-bg-surface-hi'
              }`}
            >
              {t(o.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
