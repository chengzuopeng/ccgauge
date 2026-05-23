'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { DateRangePicker } from '@/components/date-range-picker';

// Presets that share the segmented control. `custom` is rendered as a
// separate trigger button with a popover — keeping it out of this list
// keeps the segmented control's keyboard nav / radio semantics clean.
const PRESETS = [
  { value: '1d', tk: 'range.today' },
  { value: '7d', tk: 'range.7d' },
  { value: '30d', tk: 'range.30d' },
  { value: '90d', tk: 'range.90d' },
  { value: 'all', tk: 'range.all' },
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  // Round-trip check rejects calendar overflow like 2025-02-30.
  // Mirrors `parseIsoDate` in lib/range.ts but kept inline because
  // this is a client-side check that doesn't need date parsing
  // beyond yes/no.
  const m = ISO_DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  const d = new Date(y, month - 1, day);
  return (
    !Number.isNaN(d.getTime()) &&
    d.getFullYear() === y &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/** Parse YYYY-MM-DD into a local-midnight Date, or undefined. */
function parseLocalIso(s: string): Date | undefined {
  if (!isValidIsoDate(s)) return undefined;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  return new Date(y, m - 1, d);
}

/** Format a Date as local YYYY-MM-DD (NOT UTC). */
function formatLocalIso(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Render a YYYY-MM-DD into a short locale-aware label (e.g. "May 22").
 *
 * The `locale` arg is the app's i18n locale (`'en'` / `'zh'`), NOT the
 * browser's default — without this override `Intl.DateTimeFormat(undefined, ...)`
 * picks whatever the OS / browser is set to, so a Chinese OS would show
 * "5月22日" even when the user toggled the app to English.
 *
 * Falls back to the raw string if parsing fails — better to show
 * something than a blank button.
 */
function formatDateShort(s: string, locale: string): string {
  if (!isValidIsoDate(s)) return s;
  const d = new Date(s + 'T00:00:00');
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d);
}

export function RangePicker({ defaultValue = '7d' }: { defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { t, locale } = useI18n();

  const rawCurrent = params.get('range') || defaultValue;
  const isPreset = PRESETS.some((o) => o.value === rawCurrent);
  const isCustom = rawCurrent === 'custom';
  // Anything outside known presets / custom falls back to `defaultValue`.
  const current = isPreset ? rawCurrent : isCustom ? 'custom' : defaultValue;

  const urlFrom = params.get('from') || '';
  const urlTo = params.get('to') || '';

  // Popover state + local range buffer. We don't push to the URL on
  // every day-click — only when the user confirms via Apply — so the
  // calendar can stay open while the user dials in both bounds.
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: parseLocalIso(urlFrom),
    to: parseLocalIso(urlTo),
  }));

  const wrapRef = useRef<HTMLDivElement>(null);

  // Sync URL → local draft when the URL changes externally (back/forward
  // nav, hand-edited query string, …) OR when the user re-opens the
  // popover. Without the `open` trigger, an uncommitted partial
  // selection from a previous Cancel would silently persist into the
  // next session — first click would then look like the library
  // "extended" a phantom range instead of starting fresh.
  useEffect(() => {
    setDraft({
      from: parseLocalIso(urlFrom),
      to: parseLocalIso(urlTo),
    });
  }, [urlFrom, urlTo, open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function setPreset(v: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', v);
    // Always strip custom-only params when switching to a preset so
    // they don't linger in the URL and confuse the API on next refresh.
    next.delete('from');
    next.delete('to');
    router.push(`${pathname}?${next.toString()}`);
    setOpen(false);
  }

  function applyCustom() {
    const from = draft?.from;
    if (!from) return;
    const to = draft?.to;
    const next = new URLSearchParams(params.toString());
    next.set('range', 'custom');
    next.set('from', formatLocalIso(from));
    if (to) next.set('to', formatLocalIso(to));
    else next.delete('to');
    router.push(`${pathname}?${next.toString()}`);
    setOpen(false);
  }

  // Trigger label: shrink the date range into "May 1 – May 22" when
  // active, else show the bare "Custom" placeholder. Pass the app's
  // i18n locale to Intl so the label follows the language toggle, not
  // the browser default.
  const customLabel = (() => {
    if (!isCustom || !urlFrom) return t('range.custom');
    if (urlTo) return `${formatDateShort(urlFrom, locale)} – ${formatDateShort(urlTo, locale)}`;
    // open-ended (from → now)
    return `${formatDateShort(urlFrom, locale)} →`;
  })();

  // Pretty draft labels for the popover header so the user can see
  // what's currently picked before they commit. Format choice notes:
  //  - "long" month + "numeric" day is wide enough in EN ("May 22, 2026")
  //    to never wrap in a 144px column, but short enough that ZH
  //    ("2026年5月22日") still fits in the same slot.
  //  - We keep `year` because users frequently dial in custom ranges
  //    that cross year boundaries (e.g. "2025-12-28 → 2026-01-05") and
  //    a year-less label would be ambiguous there.
  const draftFromLabel = draft?.from
    ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(draft.from)
    : '';
  const draftToLabel = draft?.to
    ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(draft.to)
    : '';

  return (
    <div ref={wrapRef} className="flex items-center gap-1">
      <div
        role="radiogroup"
        aria-label={t('range.label')}
        className="inline-flex rounded-button border border-border bg-bg-surface p-0.5 gap-0.5"
      >
        {PRESETS.map((p) => {
          const active = current === p.value;
          return (
            <button
              key={p.value}
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setPreset(p.value)}
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-all',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                active
                  ? 'bg-brand-strong text-white font-semibold shadow-sm ring-1 ring-brand/40'
                  : 'text-text-tertiary font-medium hover:text-text-primary hover:bg-bg-surface-hi',
              )}
            >
              {t(p.tk)}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'px-2.5 py-1 text-xs rounded-button border transition-all inline-flex items-center gap-1',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
            isCustom
              ? 'bg-brand-strong text-white font-semibold shadow-sm ring-1 ring-brand/40 border-transparent'
              : 'border-border bg-bg-surface text-text-tertiary font-medium hover:text-text-primary hover:bg-bg-surface-hi',
          )}
        >
          <span>{customLabel}</span>
          <span aria-hidden className={cn(isCustom ? 'text-white/80' : 'text-text-tertiary')}>▾</span>
        </button>

        {open && (
          <div
            role="dialog"
            aria-label={t('range.custom')}
            // `card-elevated` + popover shadow matches the project's
            // overlay treatment (see globals.css `.card-elevated`),
            // and the wider w-[324px] frame gives the 7-column grid
            // an honest 8px gutter on each side at p-4 padding.
            className="absolute right-0 mt-1.5 z-20 w-[324px] rounded-card border border-border-hi bg-bg-elevated shadow-popover"
          >
            {/* Header — two-column FROM/TO with token-aligned `.label`
                caps so each side has a clear name + value pair. We
                deliberately drop the inline arrow that the prior
                single-line layout used: when From is the focal point
                of "the start" and To is "the end", the spatial split
                already telegraphs direction without extra glyphs. */}
            <div className="grid grid-cols-2 gap-3 px-4 pt-4 pb-3">
              <div className="min-w-0">
                <div className="label">{t('range.from')}</div>
                <div
                  className={cn(
                    'mt-1 text-sm tabular-nums truncate',
                    draft?.from ? 'text-text-primary font-semibold' : 'text-text-tertiary',
                  )}
                >
                  {draft?.from ? draftFromLabel : '—'}
                </div>
              </div>
              <div className="min-w-0">
                <div className="label">{t('range.to')}</div>
                <div
                  className={cn(
                    'mt-1 text-sm tabular-nums truncate',
                    draft?.to ? 'text-text-primary font-semibold' : 'text-text-tertiary',
                  )}
                >
                  {draft?.to ? draftToLabel : '—'}
                </div>
              </div>
            </div>

            {/* Hairline between header and calendar, then calendar
                itself sits in a centered slot so the 7-column grid
                has consistent margins on both sides. */}
            <div className="divider-soft" />
            <div className="px-3 pt-3 pb-2 flex justify-center">
              <DateRangePicker selected={draft} onSelect={setDraft} />
            </div>

            {/* Footer — divider + project-standard `.btn` pattern.
                Buttons use the same px-3 py-1.5 text-sm signature as
                every other primary button in the dashboard, so the
                tap targets match. */}
            <div className="divider-soft" />
            <div className="flex justify-end gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {t('range.cancel')}
              </button>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!draft?.from}
                className={cn(
                  'inline-flex items-center justify-center px-3 py-1.5 rounded-button text-sm font-semibold transition-colors',
                  'bg-brand-strong text-white',
                  'hover:bg-brand-hover',
                  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-strong',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                )}
              >
                {t('range.customApply')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
