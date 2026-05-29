import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: { value: number; positiveIsGood?: boolean } | { firstTime: true; label?: string } | null;
  deltaTitle?: string;
  progress?: { value: number; tone?: 'brand' | 'success' | 'warning' | 'danger' } | null;
  accent?: 'brand' | 'success' | 'warning' | 'default';
  className?: string;
}

export function KpiCard({
  label,
  value,
  hint,
  delta,
  deltaTitle,
  progress,
  accent = 'default',
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'card card-pad relative flex flex-col gap-2 min-h-[132px] overflow-hidden',
        accent !== 'default' && 'pt-[18px] sm:pt-[22px]', // make room for accent bar
        className,
      )}
    >
      {accent !== 'default' && <AccentBar tone={accent} />}
      <div className="label truncate">{label}</div>
      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
        <div className="num-hero min-w-0 max-w-full">{value}</div>
        {delta && 'firstTime' in delta && delta.firstTime && (
          <span
            className="pill text-[11px] font-medium whitespace-nowrap text-brand bg-brand/10 border border-brand/20"
            title={deltaTitle}
          >
            {delta.label ?? 'NEW'}
          </span>
        )}
        {delta && 'value' in delta && Number.isFinite(delta.value) && (
          <DeltaPill value={delta.value} positiveIsGood={delta.positiveIsGood} title={deltaTitle} />
        )}
      </div>
      {hint && <div className="text-xs text-text-secondary mt-auto leading-snug">{hint}</div>}
      {progress && (
        <div className="mt-auto pt-2">
          <ProgressBar value={progress.value} tone={progress.tone} />
        </div>
      )}
    </div>
  );
}

function AccentBar({ tone }: { tone: 'brand' | 'success' | 'warning' }) {
  const cls = {
    brand: 'from-brand/0 via-brand/70 to-brand/0',
    success: 'from-success/0 via-success/70 to-success/0',
    warning: 'from-warning/0 via-warning/70 to-warning/0',
  }[tone];
  return (
    <div
      aria-hidden
      className={cn('absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r', cls)}
    />
  );
}

function DeltaPill({
  value,
  positiveIsGood = true,
  title,
}: {
  value: number;
  positiveIsGood?: boolean;
  title?: string;
}) {
  const positive = value >= 0;
  const good = positive === positiveIsGood;
  return (
    <span
      className={cn(
        'pill text-[11px] font-medium whitespace-nowrap border',
        good
          ? 'text-success bg-success/10 border-success/20'
          : 'text-danger bg-danger/10 border-danger/20',
      )}
      title={title}
    >
      {positive ? '↑' : '↓'} {Math.abs(value).toFixed(0)}%
    </span>
  );
}

function ProgressBar({
  value,
  tone = 'brand',
}: {
  value: number;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
}) {
  const pct = Math.max(0, Math.min(1, value));
  const colorMap = {
    brand: 'bg-brand',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  } as const;
  return (
    <div className="h-1.5 w-full bg-bg-surface-hi rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all duration-500 ease-out-soft', colorMap[tone])}
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="card card-pad min-h-[132px] flex flex-col">
      <div className="skeleton-shimmer h-3 w-20 rounded mb-3" />
      <div className="skeleton-shimmer h-8 w-32 rounded mb-2" />
      <div className="skeleton-shimmer h-3 w-24 rounded mt-auto" />
    </div>
  );
}
