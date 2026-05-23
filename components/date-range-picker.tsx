'use client';

// NOTE: react-day-picker's stock stylesheet is imported from
// `app/globals.css` (NOT here) so we can control cascade order — our
// `--rdp-*` token overrides must load AFTER the library's defaults,
// otherwise specificity ties resolve to library values (e.g. the
// default 100% circular day buttons would persist).
import { DayPicker, type DateRange } from 'react-day-picker';
import { enUS, zhCN } from 'react-day-picker/locale';
import { useI18n } from '@/lib/i18n/context';

interface Props {
  /** Currently selected range. Either bound may be undefined. */
  selected?: DateRange;
  /** Fires on every click. Caller is responsible for committing later
   *  (e.g. on an Apply button), so we don't push to URL on every tap. */
  onSelect?: (range: DateRange | undefined) => void;
  /** Hard upper bound for selectable days. Defaults to today — picking
   *  a future day for a usage report makes no sense. */
  toDate?: Date;
}

/**
 * Themed range-mode wrapper around `react-day-picker` v10's `DayPicker`.
 *
 * Theming approach: we import the library's stock CSS and override its
 * `--rdp-*` CSS variables in `app/globals.css`, scoped to `.rdp-root`.
 * The variables resolve via `var(--brand-strong)` / `var(--bg-*)`, so
 * the calendar automatically follows the dashboard's existing
 * light/dark theme switch — no extra theme prop needed.
 *
 * Locale: we map ccgauge's `'en'` / `'zh'` to date-fns' `enUS` / `zhCN`
 * so weekday header, month names, and date number formatting all track
 * the in-app language toggle (not the browser default).
 */
export function DateRangePicker({ selected, onSelect, toDate }: Props) {
  const { locale } = useI18n();
  const dfLocale = locale === 'zh' ? zhCN : enUS;
  // Default upper bound is today (local). `toDate` lets callers
  // override if a "future bookings" picker is ever needed.
  const cap = toDate ?? new Date();

  return (
    <DayPicker
      mode="range"
      locale={dfLocale}
      selected={selected}
      onSelect={onSelect}
      // `endMonth` stops the next-month chevron once the user scrolls
      // past today's month — they can't navigate into a future they
      // can't pick.
      endMonth={cap}
      // The `disabled` matcher grays out future days inside the
      // current month (whatever's after `cap`).
      disabled={{ after: cap }}
      // Single-month view fits the popover without horizontal scroll.
      // Two-month is much wider and isn't needed for our typical
      // sub-3-month custom ranges.
      numberOfMonths={1}
    />
  );
}
