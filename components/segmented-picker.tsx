'use client';

import { useSearchParams, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import { useTabIndicator } from '@/components/use-tab-indicator';
import { TabIndicator } from '@/components/tab-indicator';
import { usePendingNav } from '@/lib/use-pending-nav';

export interface SegmentedOption {
  value: string;
  tk: string;
}

interface Props {
  paramKey: string;
  defaultValue: string;
  options: SegmentedOption[];
  ariaLabel?: string;
}

export function SegmentedPicker({ paramKey, defaultValue, options, ariaLabel }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useT();
  const { pending, navigate } = usePendingNav();
  const rawCurrent = params.get(paramKey) || defaultValue;
  const current = options.some((o) => o.value === rawCurrent) ? rawCurrent : defaultValue;
  const { containerRef, rect } = useTabIndicator<HTMLDivElement>(current);

  const showFallback = rect === null;

  function set(v: string) {
    const next = new URLSearchParams(params.toString());
    next.set(paramKey, v);
    navigate(`${pathname}?${next.toString()}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const idx = options.findIndex((o) => o.value === current);
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + dir + options.length) % options.length;
    set(options[nextIdx].value);
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
    buttons?.[nextIdx]?.focus();
  }

  return (
    <div
      className={cn(
        'inline-flex rounded-button border border-border bg-bg-surface p-0.5',
        pending && 'opacity-60 cursor-progress',
      )}
      aria-busy={pending}
    >
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label={ariaLabel}
        onKeyDown={onKey}
        className="relative flex gap-0.5"
      >
        <TabIndicator rect={rect} className="ring-1 ring-brand/40" />
        {options.map((p) => {
          const active = current === p.value;
          return (
            <button
              key={p.value}
              role="radio"
              data-tab={p.value}
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => set(p.value)}
              className={cn(
                'relative z-10 px-2.5 py-1 text-xs rounded transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                active
                  ? cn(
                      'text-white font-semibold',
                      showFallback && 'bg-brand-strong shadow-sm ring-1 ring-brand/40',
                    )
                  : 'text-text-tertiary font-medium hover:text-text-primary hover:bg-bg-surface-hi',
              )}
            >
              {t(p.tk)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
