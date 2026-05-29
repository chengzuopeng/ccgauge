import {
  aggregateByModel,
  aggregateByProject,
  aggregateBySession,
  aggregateByTime,
  aggregateTotals,
  bucketKey,
  type Granularity,
} from '@/lib/aggregator';
import type {
  AssistantRecord,
  ProviderId,
  UserRecord,
} from '@/lib/types';
import { summarizeTurns } from '@/lib/turns';
import { PROVIDERS } from './schema';
import type { EffectiveSource } from './context';

export interface TurnsContext {
  users: UserRecord[];
  parentMap: Record<string, string | null>;
}

export interface FlatTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number;
  saved_usd: number;
  requests: number;
  turns: number;
}

const ZERO_TOTALS: FlatTotals = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  cost_usd: 0,
  saved_usd: 0,
  requests: 0,
  turns: 0,
};

function recordsForSource(records: AssistantRecord[], source: ProviderId): AssistantRecord[] {
  return records.filter((r) => r.source === source);
}

function reasoningSum(records: AssistantRecord[]): number {
  let total = 0;
  for (const r of records) total += r.usage.reasoning_tokens ?? 0;
  return total;
}

function withinDates(rec: AssistantRecord, opts: { from?: Date; to?: Date }): boolean {
  if (opts.from && rec.timestamp < opts.from.toISOString()) return false;
  if (opts.to && rec.timestamp > opts.to.toISOString()) return false;
  return true;
}

export function totalsForSource(
  records: AssistantRecord[],
  source: ProviderId,
  opts: { from?: Date; to?: Date },
  ctx: TurnsContext,
): FlatTotals {
  const sourceRecs = recordsForSource(records, source);
  const inWindow = sourceRecs.filter((r) => withinDates(r, opts));
  const t = aggregateTotals(sourceRecs, { source, ...opts });
  return {
    input_tokens: t.inputTokens,
    output_tokens: t.outputTokens,
    cache_read_tokens: t.cacheReadTokens,
    cache_creation_tokens: t.cacheCreationTokens,
    reasoning_tokens: reasoningSum(inWindow),
    total_tokens: t.totalTokens,
    cost_usd: t.cost,
    saved_usd: t.saved,
    requests: t.requests,
    turns: summarizeTurns(inWindow, ctx.users, ctx.parentMap).size,
  };
}

function sumTotals(parts: FlatTotals[]): FlatTotals {
  return parts.reduce(
    (acc, p) => ({
      input_tokens: acc.input_tokens + p.input_tokens,
      output_tokens: acc.output_tokens + p.output_tokens,
      cache_read_tokens: acc.cache_read_tokens + p.cache_read_tokens,
      cache_creation_tokens: acc.cache_creation_tokens + p.cache_creation_tokens,
      reasoning_tokens: acc.reasoning_tokens + p.reasoning_tokens,
      total_tokens: acc.total_tokens + p.total_tokens,
      cost_usd: acc.cost_usd + p.cost_usd,
      saved_usd: acc.saved_usd + p.saved_usd,
      requests: acc.requests + p.requests,

      turns: acc.turns + p.turns,
    }),
    { ...ZERO_TOTALS },
  );
}

export interface TotalsWithBySource {
  totals: FlatTotals;
  bySource: Record<ProviderId, FlatTotals>;
}

export function totalsWithBySource(
  records: AssistantRecord[],
  effectiveSource: EffectiveSource,
  opts: { from?: Date; to?: Date },
  ctx: TurnsContext,
): TotalsWithBySource {
  const bySource: Record<ProviderId, FlatTotals> = {
    claude: { ...ZERO_TOTALS },
    codex: { ...ZERO_TOTALS },
  };
  const sources = effectiveSource === 'all' ? PROVIDERS : [effectiveSource as ProviderId];
  for (const s of sources) {
    bySource[s] = totalsForSource(records, s, opts, ctx);
  }
  return {
    totals: sumTotals(sources.map((s) => bySource[s])),
    bySource,
  };
}

export interface TimeBucketPoint {
  label: string;
  key: string;
  totals: FlatTotals;
  bySource: Record<ProviderId, FlatTotals>;
}

export function timeBuckets(
  records: AssistantRecord[],
  effectiveSource: EffectiveSource,
  granularity: Granularity,
  opts: { from?: Date; to?: Date },
  ctx: TurnsContext,
): TimeBucketPoint[] {
  const sources = effectiveSource === 'all' ? PROVIDERS : [effectiveSource as ProviderId];

  const bucketMap = new Map<string, TimeBucketPoint>();

  for (const s of sources) {
    const sourceRecs = recordsForSource(records, s);
    const buckets = aggregateByTime(sourceRecs, granularity, {
      source: s,
      ...opts,
    });

    const reasoningByKey = new Map<string, number>();
    const fromIso = opts.from?.toISOString();
    const toIso = opts.to?.toISOString();
    const inWindow: AssistantRecord[] = [];
    for (const r of sourceRecs) {
      if (fromIso && r.timestamp < fromIso) continue;
      if (toIso && r.timestamp > toIso) continue;
      inWindow.push(r);
      const reasoning = r.usage.reasoning_tokens ?? 0;
      if (reasoning > 0) {
        const { key } = bucketKey(r.timestamp, granularity);
        reasoningByKey.set(key, (reasoningByKey.get(key) ?? 0) + reasoning);
      }
    }

    const turnsByKey = new Map<string, number>();
    const turnSums = summarizeTurns(inWindow, ctx.users, ctx.parentMap);
    for (const tn of turnSums.values()) {
      const { key } = bucketKey(tn.firstTimestamp, granularity);
      turnsByKey.set(key, (turnsByKey.get(key) ?? 0) + 1);
    }

    for (const b of buckets) {
      let entry = bucketMap.get(b.key);
      if (!entry) {
        entry = {
          key: b.key,
          label: b.label,
          totals: { ...ZERO_TOTALS },
          bySource: { claude: { ...ZERO_TOTALS }, codex: { ...ZERO_TOTALS } },
        };
        bucketMap.set(b.key, entry);
      }
      const flat: FlatTotals = {
        input_tokens: b.inputTokens,
        output_tokens: b.outputTokens,
        cache_read_tokens: b.cacheReadTokens,
        cache_creation_tokens: b.cacheCreationTokens,
        reasoning_tokens: reasoningByKey.get(b.key) ?? 0,
        total_tokens: b.totalTokens,
        cost_usd: b.cost,
        saved_usd: b.saved,
        requests: b.requests,
        turns: turnsByKey.get(b.key) ?? 0,
      };
      entry.bySource[s] = flat;
      entry.totals = sumTotals(Object.values(entry.bySource));
    }
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export interface FlatModelEntry {
  source: ProviderId;
  model: string;
  requests: number;

  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost_usd: number;
  saved_usd: number;
  pricing_resolved: boolean;
}

export function modelEntries(
  records: AssistantRecord[],
  effectiveSource: EffectiveSource,
  opts: { from?: Date; to?: Date },
  ctx: TurnsContext,
): FlatModelEntry[] {
  const sources = effectiveSource === 'all' ? PROVIDERS : [effectiveSource as ProviderId];
  const out: FlatModelEntry[] = [];
  for (const s of sources) {
    const sourceRecs = recordsForSource(records, s);
    const inWindow = sourceRecs.filter((r) => withinDates(r, opts));
    const list = aggregateByModel(sourceRecs, { source: s, ...opts });

    const turnsByModel = new Map<string, number>();
    for (const tn of summarizeTurns(inWindow, ctx.users, ctx.parentMap).values()) {
      turnsByModel.set(tn.firstModel, (turnsByModel.get(tn.firstModel) ?? 0) + 1);
    }
    for (const m of list) {
      out.push({
        source: s,
        model: m.model,
        requests: m.requests,
        turns: turnsByModel.get(m.model) ?? 0,
        input_tokens: m.inputTokens,
        output_tokens: m.outputTokens,
        cache_read_tokens: m.cacheReadTokens,
        cache_creation_tokens: m.cacheCreationTokens,
        total_tokens: m.totalTokens,
        cost_usd: m.cost,
        saved_usd: m.saved,
        pricing_resolved: m.pricingResolved,
      });
    }
  }
  return out.sort((a, b) => b.cost_usd - a.cost_usd);
}

export interface FlatProjectEntry {
  source: ProviderId;
  cwd: string;
  project_name: string;
  sessions: number;
  requests: number;

  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost_usd: number;
  saved_usd: number;
  models: string[];
  first_activity: string;
  last_activity: string;
}

export function projectEntries(
  records: AssistantRecord[],
  effectiveSource: EffectiveSource,
  opts: { from?: Date; to?: Date },
  ctx: TurnsContext,
): FlatProjectEntry[] {
  const sources = effectiveSource === 'all' ? PROVIDERS : [effectiveSource as ProviderId];
  const out: FlatProjectEntry[] = [];
  for (const s of sources) {
    const sourceRecs = recordsForSource(records, s);
    const inWindow = sourceRecs.filter((r) => withinDates(r, opts));
    const list = aggregateByProject(sourceRecs, { source: s, ...opts });
    const turnsByCwd = new Map<string, number>();
    for (const tn of summarizeTurns(inWindow, ctx.users, ctx.parentMap).values()) {
      const key = tn.cwd || '(unknown)';
      turnsByCwd.set(key, (turnsByCwd.get(key) ?? 0) + 1);
    }
    for (const p of list) {
      out.push({
        source: s,
        cwd: p.cwd,
        project_name: p.projectName,
        sessions: p.sessions,
        requests: p.requests,
        turns: turnsByCwd.get(p.cwd) ?? 0,
        input_tokens: p.inputTokens,
        output_tokens: p.outputTokens,
        cache_read_tokens: p.cacheReadTokens,
        cache_creation_tokens: p.cacheCreationTokens,
        total_tokens: p.totalTokens,
        cost_usd: p.cost,
        saved_usd: p.saved,
        models: p.models,
        first_activity: p.firstActivity,
        last_activity: p.lastActivity,
      });
    }
  }
  return out.sort((a, b) => b.cost_usd - a.cost_usd);
}

export interface FlatSessionEntry {
  source: ProviderId;
  session_id: string;
  cwd: string;
  project_name: string;
  title?: string;
  first_user_message?: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  requests: number;

  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost_usd: number;
  saved_usd: number;
  models: string[];
}

export function sessionEntries(
  records: AssistantRecord[],
  userRecords: UserRecord[],
  effectiveSource: EffectiveSource,
  opts: { from?: Date; to?: Date },
  ctx: TurnsContext,
): FlatSessionEntry[] {
  const sources = effectiveSource === 'all' ? PROVIDERS : [effectiveSource as ProviderId];
  const out: FlatSessionEntry[] = [];
  for (const s of sources) {
    const sourceRecs = recordsForSource(records, s);
    const sourceUsers = userRecords.filter((u) => u.source === s);
    const inWindow = sourceRecs.filter((r) => withinDates(r, opts));
    const list = aggregateBySession(sourceRecs, sourceUsers, { source: s, ...opts });
    const turnsBySession = new Map<string, number>();
    for (const tn of summarizeTurns(inWindow, ctx.users, ctx.parentMap).values()) {
      turnsBySession.set(tn.sessionId, (turnsBySession.get(tn.sessionId) ?? 0) + 1);
    }
    for (const sn of list) {
      out.push({
        source: s,
        session_id: sn.sessionId,
        cwd: sn.cwd,
        project_name: sn.projectName,
        title: sn.title,
        first_user_message: sn.firstUserMessage,
        start_time: sn.startTime,
        end_time: sn.endTime,
        duration_ms: sn.durationMs,
        requests: sn.requests,
        turns: turnsBySession.get(sn.sessionId) ?? 0,
        input_tokens: sn.inputTokens,
        output_tokens: sn.outputTokens,
        cache_read_tokens: sn.cacheReadTokens,
        cache_creation_tokens: sn.cacheCreationTokens,
        total_tokens: sn.totalTokens,
        cost_usd: sn.cost,
        saved_usd: sn.saved,
        models: sn.models,
      });
    }
  }
  return out.sort((a, b) => b.end_time.localeCompare(a.end_time));
}
