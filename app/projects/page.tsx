import Link from 'next/link';
import { getCachedScan } from '@/lib/data-loader/scan';
import { aggregateByProject } from '@/lib/aggregator';
import { PageShell, EmptyState } from '@/components/section';
import {
  formatTokensCompact,
  formatUSD,
  formatRelative,
  projectNameFromCwd,
} from '@/lib/utils';
import { getServerT, getServerLocale } from '@/lib/i18n/server';
import { resolveSource, filterBySource, expandSources } from '@/lib/source';
import { getProvider } from '@/lib/providers';
import { resolveCanonicalCwd } from '@/lib/project-label';
import type { AssistantRecord, ProjectSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function mergeWorktreeProjects(
  projects: ProjectSummary[],
  records: AssistantRecord[],
): ProjectSummary[] {
  const grouped = new Map<string, ProjectSummary>();

  for (const p of projects) {
    const canonical = resolveCanonicalCwd(p.cwd);

    const key = `${p.source}::${canonical}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...p,
        cwd: canonical,
        projectName: projectNameFromCwd(canonical),
      });
    } else {
      existing.requests += p.requests;
      existing.inputTokens += p.inputTokens;
      existing.outputTokens += p.outputTokens;
      existing.cacheReadTokens += p.cacheReadTokens;
      existing.cacheCreationTokens += p.cacheCreationTokens;
      existing.totalTokens += p.totalTokens;
      existing.cost += p.cost;
      existing.saved += p.saved;
      if (p.firstActivity < existing.firstActivity) existing.firstActivity = p.firstActivity;
      if (p.lastActivity > existing.lastActivity) existing.lastActivity = p.lastActivity;
      for (const m of p.models) {
        if (!existing.models.includes(m)) existing.models.push(m);
      }
    }
  }

  const sessionSets = new Map<string, Set<string>>();
  for (const r of records) {
    const key = `${r.source}::${resolveCanonicalCwd(r.cwd)}`;
    let set = sessionSets.get(key);
    if (!set) {
      set = new Set();
      sessionSets.set(key, set);
    }
    set.add(r.sessionId);
  }
  for (const [key, p] of grouped) {
    const set = sessionSets.get(key);
    if (set) p.sessions = set.size;
  }

  return Array.from(grouped.values());
}

export default async function ProjectsPage({
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
  const sources = expandSources(source);

  if (records.length === 0) {
    return (
      <PageShell title={t('projects.title')}>
        <EmptyState title={t('projects.empty')} />
      </PageShell>
    );
  }

  const rawProjects = sources.flatMap((s) => aggregateByProject(records, { source: s }));
  const projects = mergeWorktreeProjects(rawProjects, records).sort((a, b) => b.cost - a.cost);
  const totalCost = projects.reduce((s, p) => s + p.cost, 0);

  const shortenFor = (p: { source: typeof sources[number] }) => (m: string) =>
    getProvider(p.source).shortenModel(m);

  return (
    <PageShell title={t('projects.title')} desc={t('projects.subtitle', { count: projects.length })}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => {
          const pct = totalCost > 0 ? p.cost / totalCost : 0;
          return (
            <Link

              key={`${p.source}:${p.cwd}`}
              href={`/projects/${encodeURIComponent(p.cwd)}?source=${p.source}`}
              className="card card-pad hover:border-border-hi transition-colors group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-text-primary truncate group-hover:text-brand transition-colors flex items-center gap-2">
                    <span className="truncate">{p.projectName}</span>
                    {source === 'all' && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-tertiary font-medium shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={getProvider(p.source).logoSrc}
                          alt=""
                          aria-hidden
                          className="w-3.5 h-3.5 rounded-[3px] object-contain"
                        />
                        {p.source === 'claude' ? 'Claude' : 'Codex'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-tertiary truncate mt-0.5" title={p.cwd}>
                    {p.cwd}
                  </div>
                </div>
                <div className="num-mono text-text-primary text-right whitespace-nowrap">{formatUSD(p.cost)}</div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <Stat label={t('projects.stat.sessions')} value={p.sessions} />
                <Stat label={t('projects.stat.requests')} value={p.requests} />
                <Stat label={t('projects.stat.tokens')} value={formatTokensCompact(p.totalTokens, locale)} />
              </div>

              <div className="mt-4 h-1.5 bg-bg-surface-hi rounded overflow-hidden">
                <div className="h-full bg-brand rounded" style={{ width: `${pct * 100}%` }} />
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-text-tertiary gap-2">
                <span className="whitespace-nowrap">
                  {t('common.lastActivity')} {formatRelative(p.lastActivity, locale)}
                </span>
                <span className="truncate">{p.models.map(shortenFor(p)).join(', ')}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-text-tertiary">{label}</div>
      <div className="num-mono text-text-primary mt-0.5">{value}</div>
    </div>
  );
}
