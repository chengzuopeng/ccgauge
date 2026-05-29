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

export function parseCustomRange(
  fromStr?: string | null,
  toStr?: string | null,
): { from?: Date; to?: Date } {
  const from = parseIsoDate(fromStr);
  const to = parseIsoDate(toStr);
  if (to) to.setHours(23, 59, 59, 999);
  return { from, to };
}
