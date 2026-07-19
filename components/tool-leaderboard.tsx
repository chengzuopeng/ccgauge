'use client';

import { useState } from 'react';
import { cn, formatTokensCompact, formatPct } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import type { ToolDimension, ToolUsageSummary } from '@/lib/types';

interface Props {
  rows: ToolUsageSummary[];
  dimension: ToolDimension;
  locale: 'en' | 'zh';
}

type Kind = 'skill' | 'tool' | 'mcp';

function rowKind(dimension: ToolDimension, key: string): Kind {
  if (dimension === 'skill') return 'skill';
  if (dimension === 'mcp') return 'mcp';
  if (key === 'Skill') return 'skill';
  return key.startsWith('mcp__') ? 'mcp' : 'tool';
}

// mcp__server__tool → "server · tool" so the by-tool view isn't a wall of __.
function displayKey(key: string): string {
  if (key.startsWith('mcp__')) return key.split('__').slice(1).join(' · ') || key;
  return key;
}

const PILL: Record<Kind, string> = {
  skill: 'bg-brand/12 text-brand border border-brand/25',
  tool: 'bg-chart-input/12 text-chart-input border border-chart-input/25',
  mcp: 'bg-chart-cache-create/12 text-chart-cache-create border border-chart-cache-create/25',
};

export function ToolLeaderboard({ rows, dimension, locale }: Props) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);

  const total = rows.reduce((s, r) => s + r.estTokens, 0) || 1;
  const max = rows[0]?.estTokens || 1;
  const tok = (n: number) => formatTokensCompact(n, locale);

  return (
    <div className="card divide-y divide-border">
      {rows.map((r, i) => {
        const focus = i === 0;
        const kind = rowKind(dimension, r.key);
        const pct = r.estTokens / total;
        const barW = Math.max(2, (r.estTokens / max) * 100);
        const isOpen = open === r.key;
        const avg = r.calls > 0 ? Math.round(r.estTokens / r.calls) : 0;
        const largestTok = Math.round(r.largestChars / 4);
        return (
          <div key={r.key}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : r.key)}
              aria-expanded={isOpen}
              className={cn(
                'w-full text-left px-4 sm:px-5 py-3 transition-colors',
                'hover:bg-bg-surface-hi/40 focus:outline-none focus-visible:bg-bg-surface-hi/50',
                focus && 'bg-brand/5',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="num-mono text-xs text-text-tertiary w-5 shrink-0">{i + 1}</span>
                <span
                  className={cn(
                    'truncate text-sm text-text-primary',
                    focus && 'font-semibold',
                  )}
                  title={r.key}
                >
                  {displayKey(r.key)}
                </span>
                <span className={cn('pill text-[10px] shrink-0', PILL[kind])}>
                  {t(`tools.kind.${kind}`)}
                </span>
                {focus && (
                  <span className="pill text-[10px] shrink-0 bg-warning/12 text-warning border border-warning/25">
                    {t('tools.topConsumer')}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-3 shrink-0">
                  <span
                    className={cn('num-mono text-sm tabular-nums', focus ? 'text-brand' : 'text-text-secondary')}
                  >
                    {tok(r.estTokens)}
                  </span>
                  <span className="num-mono text-xs text-text-tertiary w-12 text-right">
                    {formatPct(pct, 1)}
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={cn(
                      'text-text-tertiary transition-transform',
                      isOpen && 'rotate-90',
                    )}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </span>
              </div>
              <div className="h-1.5 bg-bg-surface-hi rounded mt-2 overflow-hidden">
                <div
                  className={cn('h-full rounded', focus ? 'bg-brand' : 'bg-border-hi')}
                  style={{ width: `${barW}%` }}
                />
              </div>
            </button>

            {isOpen && (
              <div className="px-4 sm:px-5 pb-4 pt-1 bg-bg-surface/40">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-xs">
                  <Stat label={t('tools.field.estTokens')} value={`${tok(r.estTokens)} · ${formatPct(pct, 1)}`} />
                  <Stat label={t('tools.field.invocations')} value={`${r.calls} · ${t('tools.field.sessionsN', { n: r.sessions })}`} />
                  <Stat label={t('tools.field.avgPerCall')} value={tok(avg)} />
                  <Stat label={t('tools.field.largest')} value={tok(largestTok)} />
                </div>
                <div className="num-mono text-[11px] text-text-tertiary mt-3">
                  {t('tools.formula', { avg: tok(avg), calls: r.calls })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-tertiary">{label}</div>
      <div className="num-mono text-text-primary mt-1">{value}</div>
    </div>
  );
}
