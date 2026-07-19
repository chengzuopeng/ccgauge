import { getCachedScan } from '@/lib/data-loader/scan';
import { aggregateTools } from '@/lib/aggregator/tools';
import { PageShell, EmptyState } from '@/components/section';
import { SegmentedPicker } from '@/components/segmented-picker';
import { ToolLeaderboard } from '@/components/tool-leaderboard';
import { getServerT, getServerLocale } from '@/lib/i18n/server';
import { resolveSource, expandSources } from '@/lib/source';
import type { ToolDimension } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DIMS: readonly ToolDimension[] = ['skill', 'tool', 'mcp'];
function resolveDim(v?: string): ToolDimension {
  return (DIMS as readonly string[]).includes(v ?? '') ? (v as ToolDimension) : 'skill';
}

export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; by?: string }>;
}) {
  const sp = await searchParams;
  const source = await resolveSource(sp.source);
  const dimension = resolveDim(sp.by);
  const t = await getServerT();
  const locale = await getServerLocale();
  const scan = await getCachedScan();
  const sources = expandSources(source);

  const rows = aggregateTools(scan.records, scan.userRecords, dimension, { sources });

  const picker = (
    <SegmentedPicker
      paramKey="by"
      defaultValue="skill"
      ariaLabel={t('tools.dimension')}
      options={[
        { value: 'skill', tk: 'tools.by.skill' },
        { value: 'tool', tk: 'tools.by.tool' },
        { value: 'mcp', tk: 'tools.by.mcp' },
      ]}
    />
  );

  return (
    <PageShell title={t('tools.title')} desc={t('tools.subtitle', { count: rows.length })} right={picker}>
      {rows.length === 0 ? (
        <EmptyState title={t('tools.empty')} desc={t('tools.emptyDesc')} />
      ) : (
        <>
          <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-button px-3 py-2 leading-relaxed">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 mt-0.5"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            <span>{t('tools.estimate')}</span>
          </div>
          <ToolLeaderboard rows={rows} dimension={dimension} locale={locale} />
        </>
      )}
    </PageShell>
  );
}
