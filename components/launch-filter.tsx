'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import { usePendingNav } from '@/lib/use-pending-nav';
import {
  LAUNCH_COOKIE,
  LAUNCH_FILTERS,
  isLaunchFilter,
  type LaunchFilter as LaunchFilterValue,
} from '@/lib/launch';

function rememberLaunch(value: LaunchFilterValue) {
  if (typeof document === 'undefined') return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LAUNCH_COOKIE}=${value}; path=/; max-age=${oneYear}; SameSite=Lax`;
}

export function LaunchFilter({ initial }: { initial: LaunchFilterValue }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useT();
  const { pending, navigate } = usePendingNav();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  const listId = useId();
  const fromUrl = params.get('launch');
  const current: LaunchFilterValue = isLaunchFilter(fromUrl) ? fromUrl : initial;

  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function select(value: LaunchFilterValue) {
    setOpen(false);
    rememberLaunch(value);
    if (value === current) return;
    const next = new URLSearchParams(params.toString());
    next.set('launch', value);
    next.delete('page');
    navigate(`${pathname}?${next.toString()}`);
  }

  return (
    <div
      ref={wrapRef}
      className={cn('relative', pending && 'opacity-60 cursor-progress')}
      aria-busy={pending}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        onClick={() => setOpen((o) => !o)}
        className="btn focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('filter.launchLabel')}
      >
        {t(`filter.launch.${current}`)}
        <span className="text-text-tertiary ml-1" aria-hidden>▾</span>
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={triggerId}
          className="absolute right-0 mt-1 w-72 card border-border-hi shadow-lg z-20 overflow-hidden p-1"
        >
          {LAUNCH_FILTERS.map((value) => {
            const selected = value === current;
            return (
              <button
                key={value}
                role="option"
                aria-selected={selected}
                onClick={() => select(value)}
                className="w-full text-left px-2 py-1.5 rounded flex items-start gap-2 transition-colors hover:bg-bg-surface-hi focus:outline-none focus-visible:bg-bg-surface-hi"
              >
                <span
                  className={cn(
                    'mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[10px] flex-shrink-0',
                    selected ? 'bg-brand border-brand text-white' : 'border-border-hi',
                  )}
                  aria-hidden
                >
                  {selected ? '✓' : ''}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-sm',
                      selected ? 'text-text-primary' : 'text-text-secondary',
                    )}
                  >
                    {t(`filter.launchOption.${value}`)}
                  </span>
                  <span className="block text-xs text-text-tertiary">
                    {t(`filter.launchOptionHint.${value}`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
