import { NextResponse } from 'next/server';
import { getCachedScan } from '@/lib/data-loader/scan';
import { aggregateBySession } from '@/lib/aggregator';
import { resolveSource, filterBySource, expandSources } from '@/lib/source';
import { withApiErrorHandling } from '@/lib/api/error-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const source = await resolveSource(url.searchParams.get('source'));
  const scan = await getCachedScan();
  const records = filterBySource(scan.records, source);
  const userRecords = filterBySource(scan.userRecords, source);

  const sessions = expandSources(source)
    .flatMap((s) => aggregateBySession(records, userRecords, { source: s }))
    .sort((a, b) => b.endTime.localeCompare(a.endTime));
  return NextResponse.json({ source, sessions });
});
