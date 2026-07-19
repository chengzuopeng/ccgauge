import { NextResponse } from 'next/server';
import { refreshPricing } from '@/lib/pricing/store';
import { withApiErrorHandling } from '@/lib/api/error-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Refresh the on-disk pricing overlay from LiteLLM. `?soft=1` is the client boot
// warm-up (non-forced, TTL-gated); the "Refresh prices" button posts without it
// and forces a fetch. Awaited (not floating) and outside any RSC render, so it's
// safe. Never throws — a failed fetch returns {status:'error'} and current prices
// stay in place.
export const POST = withApiErrorHandling(async (req: Request) => {
  const soft = new URL(req.url).searchParams.get('soft') === '1';
  const result = await refreshPricing({ force: !soft });
  const httpStatus = result.status === 'error' ? 502 : 200;
  return NextResponse.json(result, { status: httpStatus });
});
