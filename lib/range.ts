export const USAGE_RANGES = ['1d', '7d', '30d', '90d', 'all', 'custom'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export function isUsageRange(v: unknown): v is UsageRange {
  return typeof v === 'string' && (USAGE_RANGES as readonly string[]).includes(v);
}

export function normalizeUsageRange(
  raw: string | null | undefined,
  fallback: UsageRange = '7d',
): UsageRange {
  return isUsageRange(raw) ? raw : fallback;
}

export function rangeToDates(range: UsageRange): { from?: Date; to?: Date } {
  const now = new Date();
  // 'all' returns no bounds. 'custom' also returns no bounds here — the
  // caller is expected to detect `range === 'custom'` and switch over to
  // `parseCustomRange(from, to)` with the URL params. Keeping the
  // signature single-arg avoids touching every existing call site.
  if (range === 'all' || range === 'custom') return {};
  if (range === '1d') {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from };
  }
  const m = range.match(/^(\d+)([dwm])$/);
  if (!m) return {};
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const from = new Date(now);
  if (unit === 'd') from.setDate(from.getDate() - n);
  else if (unit === 'w') from.setDate(from.getDate() - n * 7);
  else if (unit === 'm') from.setMonth(from.getMonth() - n);
  return { from };
}

/**
 * Parse a YYYY-MM-DD string into a local-time `Date` at 00:00:00, or
 * `undefined` if the input isn't a well-formed and calendar-valid date.
 *
 * Two-stage validation:
 *  1. Regex shape check rejects garbage like `'yesterday'` or `'25-05-01'`.
 *  2. Round-trip check rejects calendar overflow: `new Date(2025, 1, 30)`
 *     silently normalises to March 2nd, which would otherwise let a
 *     `?from=2025-02-30` typo surface as March data labelled as February.
 *     We rebuild Y-M-D from the constructed Date and reject if any
 *     component shifted.
 *
 * Kept inline (not imported from `lib/date-utils.ts`) so the test
 * harness's strip-types Node runtime can import this file standalone
 * without resolving sibling `.ts` modules.
 */
function parseIsoDate(s?: string | null): Date | undefined {
  if (!s || typeof s !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, month - 1, day);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== y ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return undefined;
  }
  return d;
}

/**
 * Parse the `from` / `to` URL params used by `range=custom`.
 *
 * - `from` is inclusive — the day the user picked at 00:00:00 local.
 * - `to`   is **also inclusive**, so we shift it to 23:59:59.999 of the
 *   same local day. Records timestamped at, e.g., 22:30 of the picked
 *   `to` date should still count.
 * - Either bound may be missing; the caller treats `undefined` as "no
 *   lower / upper bound for this side", same as `range=all`.
 * - We do **not** swap when `from > to` — that's left to the caller
 *   (the RangePicker already normalizes on Apply).
 */
export function parseCustomRange(
  fromStr?: string | null,
  toStr?: string | null,
): { from?: Date; to?: Date } {
  const from = parseIsoDate(fromStr);
  const to = parseIsoDate(toStr);
  if (to) to.setHours(23, 59, 59, 999);
  return { from, to };
}
