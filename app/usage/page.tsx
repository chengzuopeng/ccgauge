import { getCachedScan } from '@/lib/data-loader/scan';
import { PageShell, EmptyState } from '@/components/section';
import { redirect } from 'next/navigation';
import { RangePicker } from '@/components/range-picker';
import { normalizeUsageRange, parseCustomRange } from '@/lib/range';
import { ModelFilter } from '@/components/model-filter';
import { ProjectFilter } from '@/components/project-filter';
import { getServerT } from '@/lib/i18n/server';
import { resolveSource, filterBySource } from '@/lib/source';
import { getProvider } from '@/lib/providers';
import { AutoRefresh } from '@/components/auto-refresh';
import { OverviewToggle } from '@/components/overview-toggle';
import { getAllModels, getAllProjects } from '@/lib/data-loader/derived';
import { UsageDataIsland } from '@/components/usage-data-island';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    range?: string;
    from?: string;
    to?: string;
    gran?: string;
    models?: string;
    projects?: string;
    q?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const range = normalizeUsageRange(sp.range, '7d');

  if (range === 'custom' && !parseCustomRange(sp.from, sp.to).from) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v == null) continue;
      if (k === 'range' || k === 'from' || k === 'to') continue;
      qs.set(k, String(v));
    }
    qs.set('range', '7d');
    redirect(`/usage?${qs.toString()}`);
  }

  const source = await resolveSource(sp.source);
  const models = sp.models ? sp.models.split(',').filter(Boolean) : [];
  const projects = sp.projects ? sp.projects.split(',').filter(Boolean) : [];

  const t = await getServerT();

  // Only data needed to render the shell. The data island fetches
  // /api/turns client-side for the chart + KPIs + table — keeping every
  // filter change at ~20KB JSON instead of re-streaming the whole page.
  const scan = await getCachedScan();
  const allSourceRecords = filterBySource(scan.records, source);
  const allModels = getAllModels(allSourceRecords); // WeakMap-cached
  const allProjects = getAllProjects(allSourceRecords); // WeakMap-cached
  const totalRecords = allSourceRecords.length;

  const costFootnote =
    source === 'all'
      ? ''
      : getProvider(source).costFootnoteKey
        ? t(getProvider(source).costFootnoteKey as string)
        : '';

  return (
    <PageShell
      title={t('usage.title')}
      desc={t('usage.subtitle', { count: totalRecords.toLocaleString() })}
      right={
        <div className="flex items-center gap-3 flex-wrap">
          <OverviewToggle />
          <ModelFilter all={allModels} selected={models} />
          <ProjectFilter all={allProjects} selected={projects} />
          <RangePicker defaultValue="7d" />
        </div>
      }
    >
      <AutoRefresh intervalMs={15_000} />
      {totalRecords === 0 ? (
        <EmptyState title={t('common.empty.title')} desc={t('common.empty.desc')} />
      ) : (
        <UsageDataIsland costFootnote={costFootnote || undefined} />
      )}
    </PageShell>
  );
}
