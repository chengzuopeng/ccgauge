import { getIndexer } from '@/lib/data-loader/indexer';
import type { ProviderId } from '@/lib/types';
import { atEndOfDay, atStartOfDay, parseDateLike, parseLocalDateOnly } from '@/lib/date-utils';

export const MCP_INDEX_NAME = 'mcp';

export async function getMcpIndexerReady() {
  const idx = getIndexer(MCP_INDEX_NAME);
  await idx.init();
  return idx;
}

export type EffectiveSource = ProviderId | 'all';

export function parseDateRange(args: {
  range?: string;
  from?: string;
  to?: string;
}): { from?: Date; to?: Date; label: string } {
  const explicitFrom = args.from ? parseStrictDate(args.from, 'from', false) : undefined;
  const explicitTo = args.to ? parseStrictDate(args.to, 'to', true) : undefined;
  if (explicitFrom || explicitTo) {
    const label =
      explicitFrom && explicitTo
        ? `${args.from} → ${args.to}`
        : explicitFrom
          ? `from ${args.from}`
          : `until ${args.to}`;
    return { from: explicitFrom, to: explicitTo, label };
  }

  const range = (args.range || 'all').toLowerCase();
  const now = new Date();
  const startOfToday = atStartOfDay(now);
  const endOfToday = atEndOfDay(now);

  switch (range) {
    case 'today':
      return { from: startOfToday, to: endOfToday, label: 'today' };
    case 'yesterday': {
      const y = new Date(startOfToday);
      y.setDate(y.getDate() - 1);
      const yEnd = atEndOfDay(y);
      return { from: y, to: yEnd, label: 'yesterday' };
    }
    case 'this_week': {
      const monday = startOfWeek(now);
      return { from: monday, to: endOfToday, label: 'this_week' };
    }
    case 'last_week': {
      const monday = startOfWeek(now);
      const start = new Date(monday);
      start.setDate(start.getDate() - 7);
      const end = new Date(monday);
      end.setMilliseconds(end.getMilliseconds() - 1);
      return { from: start, to: end, label: 'last_week' };
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start, to: endOfToday, label: 'this_month' };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      end.setMilliseconds(end.getMilliseconds() - 1);
      return { from: start, to: end, label: 'last_month' };
    }
    case 'all':
      return { label: 'all' };
    case '7d':
    case '30d':
    case '90d': {

      const n = parseInt(range, 10);
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - (n - 1));
      return { from: start, to: endOfToday, label: range };
    }
    default:
      throw new Error(
        `invalid 'range' argument: ${JSON.stringify(args.range)}. ` +
          `Expected one of: today, yesterday, this_week, last_week, this_month, last_month, 7d, 30d, 90d, all.`,
      );
  }
}

function parseStrictDate(s: string, field: 'from' | 'to', isUpperBound: boolean): Date {
  const dt = parseDateLike(s, { upperBoundDateOnly: isUpperBound });
  if (!dt) {
    throw new Error(
      `invalid '${field}' argument: ${JSON.stringify(s)}. Expected YYYY-MM-DD or a full ISO 8601 timestamp.`,
    );
  }
  return dt;
}

export function parseDayArg(input: string | undefined): {
  from: Date;
  to: Date;
  label: string;
} {
  const now = new Date();
  const today = atStartOfDay(now);
  const lower = (input ?? 'today').toLowerCase();
  const dayOf = (d: Date) => ({ start: atStartOfDay(d), end: atEndOfDay(d) });

  if (lower === 'today') {
    const { start, end } = dayOf(today);
    return { from: start, to: end, label: 'today' };
  }
  if (lower === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    const { start, end } = dayOf(y);
    return { from: start, to: end, label: 'yesterday' };
  }
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const idx = weekday.indexOf(lower);
  if (idx >= 0) {
    const target = new Date(today);
    let diff = target.getDay() - idx;
    if (diff < 0) diff += 7;
    target.setDate(target.getDate() - diff);
    const { start, end } = dayOf(target);
    return { from: start, to: end, label: lower };
  }
  const explicit = parseLocalDateOnly(input ?? '');
  if (explicit) {
    const { start, end } = dayOf(explicit);
    return { from: start, to: end, label: input ?? '' };
  }
  throw new Error(
    `invalid 'date' argument: ${JSON.stringify(input)}. Expected today | yesterday | monday..sunday | YYYY-MM-DD.`,
  );
}

function startOfWeek(d: Date): Date {

  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(monday.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function isoOrUndefined(d: Date | undefined): string | undefined {
  return d?.toISOString();
}
