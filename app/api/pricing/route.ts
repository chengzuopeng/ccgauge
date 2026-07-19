import { NextResponse } from 'next/server';
import { getClaudePricing, getOpenAIPricing, getPricingMeta } from '@/lib/pricing/store';
import { resolveSource } from '@/lib/source';
import type { Pricing } from '@/lib/types';
import { withApiErrorHandling } from '@/lib/api/error-handler';

export const runtime = 'nodejs';

export const GET = withApiErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const source = await resolveSource(url.searchParams.get('source'));
  const meta = getPricingMeta();

  if (source === 'all') {
    const bySource: Record<string, Record<string, Pricing>> = {
      claude: getClaudePricing(),
      codex: getOpenAIPricing(),
    };
    return NextResponse.json({ source, bySource, source_kind: meta.source, meta });
  }
  const pricing: Record<string, Pricing> =
    source === 'codex' ? getOpenAIPricing() : getClaudePricing();
  return NextResponse.json({ source, pricing, source_kind: meta.source, meta });
});
