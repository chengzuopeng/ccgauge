import { NextResponse } from 'next/server';
import { BUILTIN_PRICING } from '@/lib/pricing/builtin';
import { BUILTIN_PRICING_OPENAI } from '@/lib/providers/codex/pricing';
import { resolveSource } from '@/lib/source';
import type { Pricing } from '@/lib/types';
import { withApiErrorHandling } from '@/lib/api/error-handler';

export const runtime = 'nodejs';

export const GET = withApiErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const source = await resolveSource(url.searchParams.get('source'));

  if (source === 'all') {
    const bySource: Record<string, Record<string, Pricing>> = {
      claude: BUILTIN_PRICING,
      codex: BUILTIN_PRICING_OPENAI,
    };
    return NextResponse.json({ source, bySource, source_kind: 'builtin' });
  }
  const pricing: Record<string, Pricing> =
    source === 'codex' ? BUILTIN_PRICING_OPENAI : BUILTIN_PRICING;
  return NextResponse.json({ source, pricing, source_kind: 'builtin' });
});
