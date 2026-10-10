import { NextResponse } from 'next/server';
import { getIndexerStatus, startIndexing } from '@/lib/data-loader/scan';
import { withApiErrorHandling } from '@/lib/api/error-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(async () => {
  startIndexing();
  const status = getIndexerStatus();
  return NextResponse.json({
    initialized: status.initialized,
    progress: status.progress,
  });
});
