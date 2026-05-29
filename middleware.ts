import { NextResponse, type NextRequest } from 'next/server';

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

export const config = {
  matcher: ['/usage'],
};
