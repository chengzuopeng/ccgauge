'use client';

import { useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import { usePendingNav } from '@/lib/use-pending-nav';

interface MultiSelectProps {

  paramKey: string;
  all: string[];
  selected: string[];

  render?: (v: string) => string;

  labelAllKey: string;
  labelSingleKey: string;
  labelMultiKey: string;

  ariaLabel?: string;

  searchThreshold?: number;
}

export function MultiSelect({
  paramKey,
  all,
  selected,
  render = (v) => v,
  labelAllKey,
  labelSingleKey,
  labelMultiKey,
  ariaLabel,
  searchThreshold = 6,
}: MultiSelectProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useT();
  const { pending, navigate } = usePendingNav();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  useEffect(() => {
    if (open && all.length >= searchThreshold) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    if (!open) {
      setQuery('');
      setActiveIdx(0);
    }
  }, [open, all.length, searchThreshold]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((v) => render(v).toLowerCase().includes(q) || v.toLowerCase().includes(q));
  }, [all, query, render]);

  function pushSet(set: Set<string>) {
    const next = new URLSearchParams(params.toString());
    if (set.size === 0) next.delete(paramKey);
    else next.set(paramKey, Array.from(set).join(','));
    const qs = next.toString();
    navigate(qs ? `${pathname}?${qs}` : pathname);
  }

  function toggle(v: string) {
    const set = new Set(selected);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    pushSet(set);
  }

  function clearAll() {
    pushSet(new Set());
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const v = filtered[activeIdx];
      if (v) toggle(v);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(filtered.length - 1);
    }
  }

  let labelText: string;
  if (selected.length === 0) labelText = t(labelAllKey);
  else if (selected.length === 1) labelText = t(labelSingleKey, { value: render(selected[0]) });
  else labelText = t(labelMultiKey, { count: selected.length });

  const showSearch = all.length >= searchThreshold;

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
        aria-label={ariaLabel}
      >
        {labelText}
        <span className="text-text-tertiary ml-1" aria-hidden>▾</span>
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={triggerId}
          className="absolute right-0 mt-1 w-72 card border-border-hi shadow-lg z-20 overflow-hidden"
        >
          {selected.length > 0 && (
            <div className="px-2 pt-2 pb-1.5 border-b border-border flex flex-wrap gap-1 items-center">
              {selected.slice(0, 6).map((v) => (
                <button
                  key={v}
                  onClick={() => toggle(v)}
                  className="inline-flex items-center gap-1 max-w-[160px] pl-2 pr-1.5 py-0.5 text-[11px] rounded-full bg-brand/10 text-brand border border-brand/20 hover:bg-brand/15"
                  aria-label={`Remove ${render(v)}`}
                  title={render(v)}
                >
                  <span className="truncate">{render(v)}</span>
                  <span aria-hidden className="text-brand/70">×</span>
                </button>
              ))}
              {selected.length > 6 && (
                <span className="text-[11px] text-text-tertiary px-1">+{selected.length - 6}</span>
              )}
              <button
                onClick={clearAll}
                className="ml-auto text-[11px] text-text-tertiary hover:text-text-primary px-1.5 py-0.5"
              >
                {t('filter.clearAll')}
              </button>
            </div>
          )}
          {showSearch && (
            <div className="p-2 border-b border-border">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === 'ArrowDown' ||
                    e.key === 'ArrowUp' ||
                    e.key === 'Enter' ||
                    e.key === 'Home' ||
                    e.key === 'End'
                  ) {
                    onListKeyDown(e as unknown as React.KeyboardEvent<HTMLDivElement>);
                  }
                }}
                placeholder={t('common.searchPlaceholder')}
                className="w-full px-2 py-1 text-sm rounded border border-border bg-bg-surface focus:outline-none focus:border-border-hi placeholder:text-text-tertiary text-text-primary"
              />
            </div>
          )}
          <div
            ref={listRef}
            onKeyDown={onListKeyDown}
            className="max-h-64 overflow-y-auto p-1 outline-none"
            tabIndex={-1}
          >
            {filtered.length === 0 && (
              <div className="text-xs text-text-tertiary px-2 py-3 text-center">
                {t('filter.noOptions')}
              </div>
            )}
            {filtered.map((v, i) => {
              const isSelected = selected.includes(v);
              const isActive = i === activeIdx;
              return (
                <button
                  key={v}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => toggle(v)}
                  className={cn(
                    'w-full text-left text-sm px-2 py-1.5 rounded flex items-center gap-2 transition-colors',
                    isActive ? 'bg-bg-surface-hi' : 'hover:bg-bg-surface-hi',
                    isSelected && 'text-text-primary',
                  )}
                >
                  <span
                    className={cn(
                      'w-3.5 h-3.5 rounded-sm border flex items-center justify-center text-[10px] flex-shrink-0',
                      isSelected ? 'bg-brand border-brand text-white' : 'border-border-hi',
                    )}
                    aria-hidden
                  >
                    {isSelected ? '✓' : ''}
                  </span>
                  <span className="truncate">{render(v)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
