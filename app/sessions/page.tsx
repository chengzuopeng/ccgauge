import Link from 'next/link';
import { getCachedScan } from '@/lib/data-loader/scan';
import { aggregateBySession } from '@/lib/aggregator';
import { PageShell, EmptyState } from '@/components/section';
import {
  formatTokensCompact,
  formatUSD,
  formatRelative,
  formatDuration,
  shortHash,
} from '@/lib/utils';
import { getServerT, getServerLocale } from '@/lib/i18n/server';
import { resolveSource, filterBySource, expandSources } from '@/lib/source';
import { getProvider } from '@/lib/providers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const sp = await searchParams;
  const source = await resolveSource(sp.source);
  const t = await getServerT();
  const locale = await getServerLocale();
  const scan = await getCachedScan();
  const records = filterBySource(scan.records, source);
  const userRecords = filterBySource(scan.userRecords, source);
  const sources = expandSources(source);
  // For mixed-source rows the model shortener needs to know each row's
  // provider — sessions already carry `source` after aggregation.
  const shortenFor = (s: { source: typeof sources[number] }) => (m: string) =>
    getProvider(s.source).shortenModel(m);

  if (records.length === 0) {
    return (
      <PageShell title={t('sessions.title')}>
        <EmptyState title={t('sessions.empty')} />
      </PageShell>
    );
  }

  // List-style aggregator: run per source and concatenate. Sessions never
  // span providers, so there's no risk of cross-source merging in the
  // aggregator's `sessionId` keying.
  const sessions = sources
    .flatMap((s) => aggregateBySession(records, userRecords, { source: s }))
    .sort((a, b) => b.endTime.localeCompare(a.endTime));

  return (
    <PageShell
      title={t('sessions.title')}
      desc={t('sessions.subtitle', { count: sessions.length })}
    >
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-surface-hi/30">
                <Th>{t('sessions.col.session')}</Th>
                <Th>{t('sessions.col.project')}</Th>
                <Th>{t('sessions.col.models')}</Th>
                <Th align="right">{t('sessions.col.requests')}</Th>
                <Th align="right">{t('sessions.col.tokens')}</Th>
                <Th align="right">{t('sessions.col.cost')}</Th>
                <Th align="right">{t('sessions.col.duration')}</Th>
                <Th align="right">{t('sessions.col.lastActivity')}</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.sessionId} className="border-b border-border last:border-b-0 hover:bg-bg-surface-hi/40">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/sessions/${encodeURIComponent(s.sessionId)}?source=${s.source}`}
                      className="text-text-primary hover:text-brand"
                    >
                      <div className="font-medium truncate max-w-[280px]" title={s.title || s.sessionId}>
                        {s.title || t('sessions.untitled', { hash: shortHash(s.sessionId) })}
                      </div>
                      <div className="num-mono text-xs text-text-tertiary">{shortHash(s.sessionId, 12)}</div>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-text-secondary truncate max-w-[180px]" title={s.cwd}>
                    {s.projectLabel}
                  </td>
                  <td className="px-3 py-2.5 text-text-secondary text-xs">
                    {s.models.map(shortenFor(s)).join(', ')}
                  </td>
                  <td className="px-3 py-2.5 num-mono text-right text-text-secondary">{s.requests}</td>
                  <td className="px-3 py-2.5 num-mono text-right text-text-secondary">
                    {formatTokensCompact(s.totalTokens, locale)}
                  </td>
                  <td className="px-3 py-2.5 num-mono text-right text-text-primary font-medium">
                    {formatUSD(s.cost)}
                  </td>
                  <td className="px-3 py-2.5 num-mono text-right text-text-tertiary">
                    {formatDuration(s.durationMs)}
                  </td>
                  <td className="px-3 py-2.5 num-mono text-right text-text-tertiary text-xs whitespace-nowrap">
                    {formatRelative(s.endTime, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wide whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}
