import { getCachedScan } from '@/lib/data-loader/scan';
import { recordsToTurnRowsCached } from '@/lib/data-loader/derived';
import { isUsageRange, rangeToDates, parseCustomRange, type UsageRange } from '@/lib/range';
import { resolveSource, filterBySource } from '@/lib/source';
import { resolveCanonicalCwd } from '@/lib/project-label';
import { badRequest } from '@/lib/api/error-handler';
import type { AssistantRecord, UserRecord } from '@/lib/types';
import type { EffectiveSource } from '@/lib/source';
import type { UsageTurnRow } from '@/lib/serialize';

/**
 * The filter half of a /usage query — everything that decides WHICH records a
 * turn list is built from. Deliberately excludes sort / search / page, which
 * only reorder or slice an already-built list.
 *
 * Shared so `/api/turns` and `/api/turns/children` derive their rows from one
 * definition; if they drifted, an expanded row would show the calls of a
 * different turn than the one clicked.
 */
export interface TurnFilters {
  source: EffectiveSource;
  range: UsageRange;
  dates: { from?: Date; to?: Date };
  models: string[];
  projects: string[];
  fromIso: string;
  toIso: string;
  /** LRU key for `recordsToTurnRowsCached`. */
  filterKey: string;
}

export interface TurnScope {
  scan: Awaited<ReturnType<typeof getCachedScan>>;
  allSourceRecords: AssistantRecord[];
  allSourceUsers: UserRecord[];
  /** Project-filtered only — totals and trend aggregate over this. */
  projectFilteredRecords: AssistantRecord[];
  filteredRecords: AssistantRecord[];
  allTurns: UsageTurnRow[];
}

export async function parseTurnFilters(
  sp: URLSearchParams,
): Promise<{ filters: TurnFilters } | { error: Response }> {
  const source = await resolveSource(sp.get('source'));

  const rangeRaw = sp.get('range') || '7d';
  if (!isUsageRange(rangeRaw)) {
    return { error: badRequest(`invalid range: ${rangeRaw}`, 'invalid_range') };
  }
  const range = rangeRaw as UsageRange;

  let dates: { from?: Date; to?: Date };
  if (range === 'custom') {
    dates = parseCustomRange(sp.get('from'), sp.get('to'));
    if (!dates.from) {
      return {
        error: badRequest(
          'range=custom requires a valid `from` (YYYY-MM-DD)',
          'invalid_custom_range',
        ),
      };
    }
  } else {
    dates = rangeToDates(range);
  }

  const models = sp.get('models')?.split(',').filter(Boolean) ?? [];
  const projects = sp.get('projects')?.split(',').filter(Boolean) ?? [];
  const fromIso = dates.from ? dates.from.toISOString() : '';
  const toIso = dates.to ? dates.to.toISOString() : '';

  // Cache key uses the range TOKEN (not the resolved fromIso/toIso) so 7d /
  // 30d / 90d hit the same cache entry on every request — `rangeToDates`
  // recomputes `now - Nd` per call, which would otherwise drift the key. For
  // `custom`, we include the explicit from/to since those ARE stable.
  const customStamp = range === 'custom' ? `${fromIso}~${toIso}` : '';
  const filterKey = [
    source,
    range,
    customStamp,
    models.slice().sort().join(','),
    projects.slice().sort().join(','),
  ].join('|');

  return { filters: { source, range, dates, models, projects, fromIso, toIso, filterKey } };
}

export async function loadTurnScope(f: TurnFilters): Promise<TurnScope> {
  const scan = await getCachedScan();
  const allSourceRecords = filterBySource(scan.records, f.source);
  const allSourceUsers = filterBySource(scan.userRecords, f.source);

  const projectsSet = new Set(f.projects);
  const projectFilteredRecords = f.projects.length
    ? allSourceRecords.filter((r) => projectsSet.has(resolveCanonicalCwd(r.cwd)))
    : allSourceRecords;

  const filteredRecords = projectFilteredRecords.filter((r) => {
    if (f.dates.from && r.timestamp < f.fromIso) return false;
    if (f.dates.to && r.timestamp > f.toIso) return false;
    if (f.models.length && !f.models.includes(r.model)) return false;
    return true;
  });

  const allTurns = recordsToTurnRowsCached(
    scan,
    f.filterKey,
    filteredRecords,
    allSourceUsers,
    scan.parentMap,
  );

  return {
    scan,
    allSourceRecords,
    allSourceUsers,
    projectFilteredRecords,
    filteredRecords,
    allTurns,
  };
}
