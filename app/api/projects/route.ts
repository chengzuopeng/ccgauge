import { NextResponse } from 'next/server';
import { getCachedScan } from '@/lib/data-loader/scan';
import { aggregateByProject } from '@/lib/aggregator';
import { resolveSource, filterBySource, expandSources } from '@/lib/source';
import { withApiErrorHandling } from '@/lib/api/error-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const source = await resolveSource(url.searchParams.get('source'));
  const scan = await getCachedScan();
  const records = filterBySource(scan.records, source);

  const projects = expandSources(source)
    .flatMap((s) => aggregateByProject(records, { source: s }))
    .sort((a, b) => b.cost - a.cost);
  return NextResponse.json({ source, projects });
});
