'use client';

import { formatUSD, formatPct, formatTokensCompact, shortenModel } from '@/lib/utils';
import type { ModelSummary } from '@/lib/types';
import { useT, useI18n } from '@/lib/i18n/context';

const MODEL_COLORS: Record<string, string> = {
  opus: 'rgb(var(--chart-output))',
  sonnet: 'rgb(var(--chart-input))',
  haiku: 'rgb(var(--chart-cache-read))',
};

function colorFor(model: string): string {
  for (const k of Object.keys(MODEL_COLORS)) {
    if (model.toLowerCase().includes(k)) return MODEL_COLORS[k];
  }
  return 'rgb(var(--chart-cache-create))';
}

export function ModelBarChart({ models }: { models: ModelSummary[] }) {
  const t = useT();
  const { locale } = useI18n();
  if (!models.length) {
    return <div className="text-sm text-text-tertiary">{t('chart.empty')}</div>;
  }
  const max = Math.max(...models.map((m) => m.cost), 0.0001);
  const totalCost = models.reduce((s, m) => s + m.cost, 0);
  return (
    <div className="space-y-3.5">
      {models.map((m) => {
        const pct = totalCost > 0 ? m.cost / totalCost : 0;
        return (
          <div key={m.model} className="space-y-1.5 group">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-text-primary truncate">{shortenModel(m.model)}</span>
              <span className="text-xs text-text-tertiary tabular-nums flex-1 text-right">
                {formatTokensCompact(m.totalTokens, locale)} · {formatPct(pct)}
              </span>
              <span className="num-mono font-medium text-text-primary min-w-[80px] text-right">
                {formatUSD(m.cost)}
              </span>
            </div>
            <div className="h-2 w-full bg-bg-surface-hi rounded-full overflow-hidden">
              {/* `bar-grow` sweeps the fill out from the left once on mount
                  (transform), while `transition-all` keeps the width gliding
                  to new values on refresh — different properties, no clash. */}
              <div
                className="bar-grow h-full rounded-full transition-all duration-500 ease-out-soft group-hover:brightness-110"
                style={{ width: `${(m.cost / max) * 100}%`, background: colorFor(m.model) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
