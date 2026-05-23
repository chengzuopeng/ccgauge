import { NextResponse, type NextRequest } from 'next/server';

// Strict YYYY-MM-DD with calendar-overflow rejection. We can't import
// from `lib/range.ts` here because middleware runs on the Edge runtime,
// which has its own module graph constraints — duplicating the tiny
// validator keeps the bundle minimal and the file self-contained.
function isValidIsoDate(s: string | null): boolean {
  if (!s) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, month - 1, day);
  return (
    !Number.isNaN(d.getTime()) &&
    d.getFullYear() === y &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/**
 * Edge middleware that canonicalises invalid `/usage?range=custom` URLs
 * BEFORE the page renders. The Usage RSC also redirects defensively if
 * someone bypasses this (e.g. middleware misconfigured), but the page
 * version is forced into a 1s meta-refresh because RSC is a streaming
 * context. Here on the Edge we can return a proper HTTP 307 instantly
 * with no skeleton flash.
 *
 * Contract (mirrors /api/usage and /api/export/usage):
 *  - `range=custom` requires a calendar-valid `?from=YYYY-MM-DD`.
 *  - `to` is optional; we don't validate it here because the page can
 *    safely treat an invalid `to` as "no upper bound".
 *  - On invalid input we drop `range`, `from`, `to` and force
 *    `range=7d`, preserving everything else (models, projects, source,
 *    search query, sort, etc.).
 */
export function middleware(req: NextRequest) {
  const { searchParams, pathname } = req.nextUrl;
  if (pathname !== '/usage') return;
  if (searchParams.get('range') !== 'custom') return;
  if (isValidIsoDate(searchParams.get('from'))) return;

  const next = req.nextUrl.clone();
  next.searchParams.delete('range');
  next.searchParams.delete('from');
  next.searchParams.delete('to');
  next.searchParams.set('range', '7d');
  return NextResponse.redirect(next, 307);
}

// Scope: only /usage. Keep this list tight so the Edge runtime doesn't
// invoke us on API routes, /_next assets, or anything else.
export const config = {
  matcher: ['/usage'],
};
