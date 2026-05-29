import { NextResponse } from 'next/server';
import { getCachedScan } from '@/lib/data-loader/scan';
import {
  aggregateByModel,
  aggregateByProject,
  aggregateByTime,
  aggregateTotals,
  isGranularity,
} from '@/lib/aggregator';
import { isUsageRange, rangeToDates, parseCustomRange } from '@/lib/range';
import { resolveSource, filterBySource, expandSources } from '@/lib/source';
import { combineTimeBuckets, combineTotals } from '@/lib/source-merge';
import { badRequest, withApiErrorHandling } from '@/lib/api/error-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const source = await resolveSource(url.searchParams.get('source'));
  const rangeRaw = url.searchParams.get('range') || 'all';
  if (!isUsageRange(rangeRaw)) {
    return badRequest(`invalid range: ${rangeRaw}`, 'invalid_range');
  }
  const range = rangeRaw;
  const granRaw = url.searchParams.get('gran') || 'day';
  if (!isGranularity(granRaw)) {
    return badRequest(`invalid granularity: ${granRaw}`, 'invalid_granularity');
  }
  const gran = granRaw;
  const models = url.searchParams.get('models')?.split(',').filter(Boolean) ?? undefined;
  const projects = url.searchParams.get('projects')?.split(',').filter(Boolean) ?? undefined;
  const view = url.searchParams.get('view') || 'time';

  let dates: { from?: Date; to?: Date };
  if (range === 'custom') {
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    dates = parseCustomRange(fromParam, toParam);
    if (!dates.from) {
      return badRequest(
        'range=custom requires a valid `from` (YYYY-MM-DD)',
        'invalid_custom_range',
      );
    }
  } else {
    dates = rangeToDates(range);
  }
  const baseOpts = { from: dates.from, to: dates.to, models, projects };

  const scan = await getCachedScan();
  const records = filterBySource(scan.records, source);
  const sources = expandSources(source);

  const totals = combineTotals(
    sources.map((s) => aggregateTotals(records, { ...baseOpts, source: s })),
  );

  if (view === 'time') {
    const buckets = combineTimeBuckets(
      sources.map((s) => aggregateByTime(records, gran, { ...baseOpts, source: s })),
    );
    return NextResponse.json({ source, totals, buckets });
  }
  if (view === 'model') {

    const modelList = sources
      .flatMap((s) => aggregateByModel(records, { ...baseOpts, source: s }))
      .sort((a, b) => b.cost - a.cost);
    return NextResponse.json({ source, totals, models: modelList });
  }
  if (view === 'project') {

    const projectList = sources
      .flatMap((s) => aggregateByProject(records, { ...baseOpts, source: s }))
      .sort((a, b) => b.cost - a.cost);
    return NextResponse.json({ source, totals, projects: projectList });
  }
  return NextResponse.json({ error: 'invalid view' }, { status: 400 });
});
