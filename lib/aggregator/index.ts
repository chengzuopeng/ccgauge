import type {
  AggregateBucket,
  AssistantRecord,
  ModelSummary,
  ProjectSummary,
  ProviderId,
  SessionSummary,
  UserRecord,
} from '../types';
import { costOfRecord } from '../pricing/calculate';
import { getProvider } from '../providers';
import { projectNameFromCwd } from '../utils';
import { resolveProjectLabel } from '../project-label';

export const GRANULARITIES = ['hour', 'day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export function isGranularity(v: unknown): v is Granularity {
  return typeof v === 'string' && (GRANULARITIES as readonly string[]).includes(v);
}

/** Public so callers (e.g. MCP formatters) can re-bucket records under
 *  the same key scheme to layer extra fields on top of `aggregateByTime`. */
export function bucketKey(ts: string, gran: Granularity): { key: string; label: string } {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  if (gran === 'hour') {
    return { key: `${yyyy}-${mm}-${dd}T${hh}`, label: `${mm}/${dd} ${hh}:00` };
  }
  if (gran === 'day') {
    return { key: `${yyyy}-${mm}-${dd}`, label: `${mm}/${dd}` };
  }
  if (gran === 'week') {
    const monday = new Date(d);
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    const wm = String(monday.getMonth() + 1).padStart(2, '0');
    const wd = String(monday.getDate()).padStart(2, '0');
    return {
      key: `${monday.getFullYear()}-W${wm}${wd}`,
      label: `Wk ${wm}/${wd}`,
    };
  }
  return { key: `${yyyy}-${mm}`, label: `${yyyy}-${mm}` };
}

export interface AggregateOpts {
  source: ProviderId;
  from?: Date;
  to?: Date;
  models?: string[];
  projects?: string[];
}

/** Precomputed loop bounds. `Date.toISOString()` and array `.includes()`
 *  are individually cheap, but on the weekly_summary path we used to call
 *  them N × M times (N records, M filters). Hoist them once per entry
 *  point instead. */
interface PreparedOpts {
  source: ProviderId;
  fromIso?: string;
  toIso?: string;
  models?: ReadonlySet<string>;
  projects?: ReadonlySet<string>;
}

function prepareOpts(opts: AggregateOpts): PreparedOpts {
  return {
    source: opts.source,
    fromIso: opts.from?.toISOString(),
    toIso: opts.to?.toISOString(),
    models: opts.models && opts.models.length ? new Set(opts.models) : undefined,
    projects: opts.projects && opts.projects.length ? new Set(opts.projects) : undefined,
  };
}

function withinRangePrepared(rec: AssistantRecord, p: PreparedOpts): boolean {
  if (rec.source !== p.source) return false;
  if (p.fromIso && rec.timestamp < p.fromIso) return false;
  if (p.toIso && rec.timestamp > p.toIso) return false;
  if (p.models && !p.models.has(rec.model)) return false;
  if (p.projects && !p.projects.has(rec.cwd)) return false;
  return true;
}

export function aggregateByTime(
  records: AssistantRecord[],
  gran: Granularity,
  opts: AggregateOpts,
): AggregateBucket[] {
  const buckets = new Map<string, AggregateBucket>();
  const prepared = prepareOpts(opts);
  for (const rec of records) {
    if (!withinRangePrepared(rec, prepared)) continue;
    const { key, label } = bucketKey(rec.timestamp, gran);
    let b = buckets.get(key);
    if (!b) {
      b = makeBucket(key, label);
      buckets.set(key, b);
    }
    pushRecord(b, rec);
  }
  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function makeBucket(key: string, label: string): AggregateBucket {
  return {
    key,
    label,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    cost: 0,
    saved: 0,
    requests: 0,
    models: {},
  };
}

function pushRecord(b: AggregateBucket, rec: AssistantRecord) {
  const cost = costOfRecord(rec);
  b.inputTokens += rec.usage.input_tokens;
  b.outputTokens += rec.usage.output_tokens;
  b.cacheReadTokens += rec.usage.cache_read_input_tokens;
  b.cacheCreationTokens += rec.usage.cache_creation_input_tokens;
  b.totalTokens =
    b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheCreationTokens;
  b.cost += cost.total;
  b.saved += cost.saved;
  b.requests += 1;
  const m = b.models[rec.model] ?? { tokens: 0, cost: 0, requests: 0 };
  m.tokens += rec.usage.input_tokens + rec.usage.output_tokens + rec.usage.cache_read_input_tokens + rec.usage.cache_creation_input_tokens;
  m.cost += cost.total;
  m.requests += 1;
  b.models[rec.model] = m;
}

export function aggregateByModel(
  records: AssistantRecord[],
  opts: AggregateOpts,
): ModelSummary[] {
  const map = new Map<string, ModelSummary>();
  const prepared = prepareOpts(opts);
  for (const rec of records) {
    if (!withinRangePrepared(rec, prepared)) continue;
    let s = map.get(rec.model);
    if (!s) {
      const { pricing, matchType } = getProvider(rec.source).resolvePricing(rec.model);
      s = {
        model: rec.model,
        source: rec.source,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        cost: 0,
        saved: 0,
        pricing,
        pricingResolved: matchType === 'exact' || matchType === 'date-stripped' || matchType === 'prefix-stripped',
      };
      map.set(rec.model, s);
    }
    const cost = costOfRecord(rec);
    s.requests += 1;
    s.inputTokens += rec.usage.input_tokens;
    s.outputTokens += rec.usage.output_tokens;
    s.cacheReadTokens += rec.usage.cache_read_input_tokens;
    s.cacheCreationTokens += rec.usage.cache_creation_input_tokens;
    s.totalTokens =
      s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheCreationTokens;
    s.cost += cost.total;
    s.saved += cost.saved;
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

export function aggregateByProject(
  records: AssistantRecord[],
  opts: AggregateOpts,
): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>();
  const sessionsByProject = new Map<string, Set<string>>();
  const prepared = prepareOpts(opts);
  for (const rec of records) {
    if (!withinRangePrepared(rec, prepared)) continue;
    const cwd = rec.cwd || '(unknown)';
    let s = map.get(cwd);
    if (!s) {
      s = {
        source: opts.source,
        cwd,
        projectName: projectNameFromCwd(cwd),
        sessions: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        cost: 0,
        saved: 0,
        firstActivity: rec.timestamp,
        lastActivity: rec.timestamp,
        models: [],
      };
      map.set(cwd, s);
      sessionsByProject.set(cwd, new Set());
    }
    sessionsByProject.get(cwd)!.add(rec.sessionId);
    const cost = costOfRecord(rec);
    s.requests += 1;
    s.inputTokens += rec.usage.input_tokens;
    s.outputTokens += rec.usage.output_tokens;
    s.cacheReadTokens += rec.usage.cache_read_input_tokens;
    s.cacheCreationTokens += rec.usage.cache_creation_input_tokens;
    s.totalTokens =
      s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheCreationTokens;
    s.cost += cost.total;
    s.saved += cost.saved;
    if (rec.timestamp < s.firstActivity) s.firstActivity = rec.timestamp;
    if (rec.timestamp > s.lastActivity) s.lastActivity = rec.timestamp;
    if (!s.models.includes(rec.model)) s.models.push(rec.model);
  }
  for (const [cwd, set] of sessionsByProject) {
    const s = map.get(cwd)!;
    s.sessions = set.size;
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

export function aggregateBySession(
  records: AssistantRecord[],
  userRecords: UserRecord[],
  opts: AggregateOpts,
): SessionSummary[] {
  const map = new Map<string, SessionSummary>();
  const prepared = prepareOpts(opts);
  for (const rec of records) {
    if (!withinRangePrepared(rec, prepared)) continue;
    const sid = rec.sessionId || rec.uuid;
    let s = map.get(sid);
    if (!s) {
      s = {
        sessionId: sid,
        source: rec.source,
        cwd: rec.cwd,
        projectName: projectNameFromCwd(rec.cwd),
        // Worktree-aware label so the sessions table shows the same
        // identifier the usage table does for the same record (e.g.
        // `ai-self-web (playwright)` instead of just `playwright`).
        // `resolveProjectLabel` caches per-cwd, so this is one fs.stat
        // per unique cwd across the whole aggregation.
        projectLabel: resolveProjectLabel(rec.cwd),
        startTime: rec.timestamp,
        endTime: rec.timestamp,
        durationMs: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        cost: 0,
        saved: 0,
        models: [],
        modelBreakdown: {},
      };
      map.set(sid, s);
    }
    const cost = costOfRecord(rec);
    s.requests += 1;
    s.inputTokens += rec.usage.input_tokens;
    s.outputTokens += rec.usage.output_tokens;
    s.cacheReadTokens += rec.usage.cache_read_input_tokens;
    s.cacheCreationTokens += rec.usage.cache_creation_input_tokens;
    s.totalTokens =
      s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheCreationTokens;
    s.cost += cost.total;
    s.saved += cost.saved;
    if (rec.timestamp < s.startTime) s.startTime = rec.timestamp;
    if (rec.timestamp > s.endTime) s.endTime = rec.timestamp;
    if (!s.models.includes(rec.model)) s.models.push(rec.model);
    const mb = s.modelBreakdown[rec.model] ?? { tokens: 0, cost: 0, requests: 0 };
    mb.tokens +=
      rec.usage.input_tokens +
      rec.usage.output_tokens +
      rec.usage.cache_read_input_tokens +
      rec.usage.cache_creation_input_tokens;
    mb.cost += cost.total;
    mb.requests += 1;
    s.modelBreakdown[rec.model] = mb;
  }

  const firstUserBySession = new Map<string, UserRecord>();
  for (const u of userRecords) {
    const existing = firstUserBySession.get(u.sessionId);
    if (!existing || u.timestamp < existing.timestamp) {
      firstUserBySession.set(u.sessionId, u);
    }
  }

  for (const s of map.values()) {
    s.durationMs = Math.max(0, new Date(s.endTime).getTime() - new Date(s.startTime).getTime());
    const u = firstUserBySession.get(s.sessionId);
    if (u && u.textPreview) {
      s.firstUserMessage = u.textPreview;
      s.title = u.textPreview.slice(0, 80);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.endTime.localeCompare(a.endTime));
}

export function aggregateTotals(
  records: AssistantRecord[],
  opts: AggregateOpts,
): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
  saved: number;
  requests: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let cost = 0;
  let saved = 0;
  let requests = 0;
  const prepared = prepareOpts(opts);
  for (const rec of records) {
    if (!withinRangePrepared(rec, prepared)) continue;
    const c = costOfRecord(rec);
    inputTokens += rec.usage.input_tokens;
    outputTokens += rec.usage.output_tokens;
    cacheReadTokens += rec.usage.cache_read_input_tokens;
    cacheCreationTokens += rec.usage.cache_creation_input_tokens;
    cost += c.total;
    saved += c.saved;
    requests += 1;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    cost,
    saved,
    requests,
  };
}
