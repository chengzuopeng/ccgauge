'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useT, useI18n } from '@/lib/i18n/context';
import type { TokenStackDatum } from './token-stack-chart';

// Reuses `TokenStackDatum` so the overview page can carry one combined
// payload across both metric views — `turns` is the conversation count
// (one per user prompt, matching the usage table's collapsed rows).

export function ConversationsBarChart({
  data,
  height = 'h-72',
}: {
  data: TokenStackDatum[];
  height?: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  if (!data.length) {
    return (
      <div className={`${height} flex items-center justify-center text-text-tertiary text-sm`}>
        {t('chart.empty')}
      </div>
    );
  }
  const fmtCount = (v: number) =>
    locale === 'zh' && v >= 10_000
      ? `${(v / 10_000).toFixed(1)}万`
      : v.toLocaleString();
  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 8 }} barCategoryGap="22%">
          {/* Subtle vertical sheen — full brand at the top fading down. Single
              series so it adds depth without muddying any category coding.
              Static (no enter animation) to stay calm under auto-refresh. */}
          <defs>
            <linearGradient id="convBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity={0.95} />
              <stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity={0.5} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="rgb(var(--chart-grid))"
            strokeOpacity={0.6}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: 'rgb(var(--chart-axis))', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={32}
            tickMargin={8}
          />
          <YAxis
            tickFormatter={(v) => fmtCount(Number(v))}
            tick={{ fill: 'rgb(var(--chart-axis))', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickMargin={4}
          />
          <Tooltip
            content={<ConversationsTooltip />}
            cursor={{ fill: 'rgb(var(--text-primary) / 0.05)', radius: 4 }}
          />
          <Bar dataKey="turns" fill="url(#convBarGrad)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ConversationsTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload: TokenStackDatum }>;
  label?: string;
}) {
  const t = useT();
  if (!props.active || !props.payload || !props.payload.length) return null;
  const d = props.payload[0].payload;
  return (
    <div className="card-elevated border border-border-hi rounded-card p-3 text-xs min-w-[180px]">
      <div className="font-medium text-text-primary mb-2">{props.label}</div>
      <div className="flex items-center justify-between">
        <span className="text-text-secondary">{t('chart.tooltip.conversations')}</span>
        <span className="num-mono text-text-primary">{(d.turns ?? 0).toLocaleString()}</span>
      </div>
      {/* Surface raw request count as a small footnote — it's the same data
          users see on the usage table when they expand a row, so it's helpful
          context but shouldn't be the headline number. */}
      <div className="flex items-center justify-between mt-1 text-text-tertiary">
        <span>{t('chart.tooltip.requests')}</span>
        <span className="num-mono">{d.requests.toLocaleString()}</span>
      </div>
    </div>
  );
}
