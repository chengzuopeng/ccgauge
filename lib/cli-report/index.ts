import { getCachedScan } from '@/lib/data-loader/scan';
import {
  aggregateByModel,
  aggregateByProject,
  aggregateBySession,
  aggregateByTime,
  aggregateTotals,
  bucketKey,
  isGranularity,
  type AggregateOpts,
  type Granularity,
} from '@/lib/aggregator';
import { isUsageRange, rangeToDates } from '@/lib/range';
import { ALL_PROVIDER_IDS, getProvider, isProviderId } from '@/lib/providers';
import type { ProviderId, AssistantRecord, ScanResult } from '@/lib/types';
import { summarizeTurns } from '@/lib/turns';
import { formatTokensCompact, formatUSD, formatPct } from '@/lib/utils';

export type Dim = 'model' | 'project' | 'session';
export type SourceArg = ProviderId | 'all';
export type ReportRange = 'today' | '1d' | '7d' | '30d' | '90d' | 'all';

const REPORT_RANGES: ReportRange[] = ['today', '1d', '7d', '30d', '90d', 'all'];
const DIMS: Dim[] = ['model', 'project', 'session'];
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ReportOptions {
  range: string; // today | 1d | 7d | 30d | 90d | all
  source: SourceArg;
  by: Dim;
  gran: Granularity;
  limit: number;
  since?: string;
  until?: string;
  json?: boolean;
  color?: boolean;
  showTrend?: boolean;
  showBreakdown?: boolean;
  model?: string;
  project?: string;
}

export const DEFAULT_REPORT: ReportOptions = {
  range: '7d',
  source: 'all',
  by: 'model',
  gran: 'day',
  limit: 10,
  json: false,
  color: true,
  showTrend: true,
  showBreakdown: true,
};

// ---------- public entry ----------

export async function runReport(opts: ReportOptions): Promise<string> {
  const filled = normalizeReportOptions(opts);
  const scan = await getCachedScan();
  const sources: ProviderId[] =
    filled.source === 'all' ? ALL_PROVIDER_IDS : [filled.source];

  const data = computeReportData(scan, sources, filled);
  if (filled.json) return JSON.stringify(data, null, 2);
  return renderText(data, filled);
}

function normalizeReportOptions(opts: ReportOptions): ReportOptions {
  const filled = { ...DEFAULT_REPORT, ...opts };

  if (!isReportRange(filled.range)) {
    throw new Error(invalidOptionMessage('range', filled.range, REPORT_RANGES));
  }
  if (filled.source !== 'all' && !isProviderId(filled.source)) {
    throw new Error(invalidOptionMessage('source', filled.source, ['claude', 'codex', 'all']));
  }
  if (!isDim(filled.by)) {
    throw new Error(invalidOptionMessage('by', filled.by, DIMS));
  }
  if (!isGranularity(filled.gran)) {
    throw new Error(invalidOptionMessage('gran', filled.gran, ['hour', 'day', 'week', 'month']));
  }
  if (filled.since) parseReportDate(filled.since, 'since');
  if (filled.until) parseReportDate(filled.until, 'until');

  const dates = resolveRange(filled);
  if (dates.from && dates.until && dates.from.getTime() > dates.until.getTime()) {
    throw new Error('invalid date range: --since must be before or equal to --until');
  }

  return filled;
}

function isReportRange(v: unknown): v is ReportRange {
  return typeof v === 'string' && REPORT_RANGES.includes(v as ReportRange);
}

function isDim(v: unknown): v is Dim {
  return typeof v === 'string' && DIMS.includes(v as Dim);
}

function invalidOptionMessage(name: string, value: unknown, expected: readonly string[]): string {
  return `invalid ${name}: ${JSON.stringify(value)}. Expected one of: ${expected.join(', ')}`;
}

// ---------- data shaping ----------

interface ReportData {
  generatedAt: string;
  range: string;
  source: SourceArg;
  by: Dim;
  gran: Granularity;
  fromIso: string | null;
  untilIso: string | null;
  totals: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    cost: number;
    saved: number;
    requests: number;
    /** Distinct user prompts (= dashboard usage-table rows) the LLM
     *  responded to in this window. One turn fans out to many `requests`
     *  via tool-use loops, reasoning steps, and sub-agents. */
    turns: number;
  };
  trend: Array<{ label: string; cost: number; tokens: number; turns: number }>;
  breakdown: Array<{
    key: string;
    label: string;
    requests: number;
    turns: number;
    tokens: number;
    cost: number;
    share: number;
    sub?: string; // e.g. model name shortened, or session id hash
  }>;
}

function computeReportData(
  scan: ScanResult,
  sources: ProviderId[],
  o: ReportOptions,
): ReportData {
  const allRecords = scan.records;
  const dates = resolveRange(o);
  const baseOpts: Omit<AggregateOpts, 'source'> = {
    from: dates.from ?? undefined,
    to: dates.until ?? undefined,
    // `o.model` / `o.project` are substring patterns, not exact matches —
    // they're applied per-record by `withinSrcAndFilters` below, so we
    // deliberately leave the aggregator's exact-match filters unset.
  };

  // Collect per-source totals + per-bucket trend
  const totals = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    cost: 0,
    saved: 0,
    requests: 0,
    turns: 0,
  };

  const trendBuckets = new Map<string, { label: string; cost: number; tokens: number; turns: number }>();

  for (const source of sources) {
    const opts: AggregateOpts = { ...baseOpts, source };
    const sourceRecs = allRecords.filter((r) => withinSrcAndFilters(r, opts, o));
    const t = aggregateTotals(sourceRecs, opts);
    totals.input += t.inputTokens;
    totals.output += t.outputTokens;
    totals.cacheRead += t.cacheReadTokens;
    totals.cacheWrite += t.cacheCreationTokens;
    totals.total += t.totalTokens;
    totals.cost += t.cost;
    totals.saved += t.saved;
    totals.requests += t.requests;
    for (const r of sourceRecs) totals.reasoning += r.usage.reasoning_tokens ?? 0;

    // Turn counts. `summarizeTurns` returns one entry per turn root —
    // a turn never spans providers, so per-source then sum is correct
    // (and matches the dashboard's overview chart convention).
    const turnSummaries = summarizeTurns(sourceRecs, scan.userRecords, scan.parentMap);
    totals.turns += turnSummaries.size;

    // Per-bucket turn counts: attribute each turn to its earliest
    // record's bucket key (same convention as dashboard / MCP).
    const turnsByKey = new Map<string, number>();
    for (const tn of turnSummaries.values()) {
      const { key } = bucketKey(tn.firstTimestamp, o.gran);
      turnsByKey.set(key, (turnsByKey.get(key) ?? 0) + 1);
    }

    const buckets = aggregateByTime(sourceRecs, o.gran, opts);
    for (const b of buckets) {
      const ex = trendBuckets.get(b.key);
      const tnCount = turnsByKey.get(b.key) ?? 0;
      if (ex) {
        ex.cost += b.cost;
        ex.tokens += b.totalTokens;
        ex.turns += tnCount;
      } else {
        trendBuckets.set(b.key, { label: b.label, cost: b.cost, tokens: b.totalTokens, turns: tnCount });
      }
    }
  }

  const trend = Array.from(trendBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  // Breakdown
  const breakdown = buildBreakdown(scan, sources, baseOpts, o);

  return {
    generatedAt: new Date().toISOString(),
    range: o.range,
    source: o.source,
    by: o.by,
    gran: o.gran,
    fromIso: dates.from?.toISOString() ?? null,
    untilIso: dates.until?.toISOString() ?? null,
    totals,
    trend,
    breakdown,
  };
}

function buildBreakdown(
  scan: ScanResult,
  sources: ProviderId[],
  base: Omit<AggregateOpts, 'source'>,
  o: ReportOptions,
): ReportData['breakdown'] {
  const allRecords = scan.records;
  if (o.by === 'model') {
    const rows: ReportData['breakdown'] = [];
    for (const source of sources) {
      const opts: AggregateOpts = { ...base, source };
      const filtered = allRecords.filter((r) => withinSrcAndFilters(r, opts, o));
      const models = aggregateByModel(filtered, opts);
      const provider = getProvider(source);
      // Group turns by first-record model (one turn → one model attribution).
      const turnsByModel = new Map<string, number>();
      for (const tn of summarizeTurns(filtered, scan.userRecords, scan.parentMap).values()) {
        turnsByModel.set(tn.firstModel, (turnsByModel.get(tn.firstModel) ?? 0) + 1);
      }
      for (const m of models) {
        rows.push({
          key: `${source}::${m.model}`,
          label: provider.shortenModel(m.model),
          requests: m.requests,
          turns: turnsByModel.get(m.model) ?? 0,
          tokens: m.totalTokens,
          cost: m.cost,
          share: 0, // filled after total
          sub: m.model,
        });
      }
    }
    return finalizeShare(rows, o.limit);
  }
  if (o.by === 'project') {
    const rows: ReportData['breakdown'] = [];
    for (const source of sources) {
      const opts: AggregateOpts = { ...base, source };
      const filtered = allRecords.filter((r) => withinSrcAndFilters(r, opts, o));
      const projects = aggregateByProject(filtered, opts);
      const turnsByCwd = new Map<string, number>();
      for (const tn of summarizeTurns(filtered, scan.userRecords, scan.parentMap).values()) {
        const key = tn.cwd || '(unknown)';
        turnsByCwd.set(key, (turnsByCwd.get(key) ?? 0) + 1);
      }
      for (const p of projects) {
        rows.push({
          key: `${source}::${p.cwd}`,
          label: p.projectName,
          requests: p.requests,
          turns: turnsByCwd.get(p.cwd) ?? 0,
          tokens: p.totalTokens,
          cost: p.cost,
          share: 0,
          sub: p.cwd,
        });
      }
    }
    return finalizeShare(rows, o.limit);
  }
  // sessions
  const rows: ReportData['breakdown'] = [];
  for (const source of sources) {
    const opts: AggregateOpts = { ...base, source };
    const filtered = allRecords.filter((r) => withinSrcAndFilters(r, opts, o));
    const sessions = aggregateBySession(filtered, [], opts);
    const turnsBySession = new Map<string, number>();
    for (const tn of summarizeTurns(filtered, scan.userRecords, scan.parentMap).values()) {
      turnsBySession.set(tn.sessionId, (turnsBySession.get(tn.sessionId) ?? 0) + 1);
    }
    for (const s of sessions) {
      rows.push({
        key: `${source}::${s.sessionId}`,
        label: s.title ?? s.sessionId.slice(0, 8),
        requests: s.requests,
        turns: turnsBySession.get(s.sessionId) ?? 0,
        tokens: s.totalTokens,
        cost: s.cost,
        share: 0,
        // Worktree-aware so the breakdown reads
        // `ai-self-web (playwright)` instead of just `playwright`,
        // matching the dashboard's usage / sessions tables.
        sub: s.projectLabel,
      });
    }
  }
  return finalizeShare(rows, o.limit);
}

function finalizeShare(
  rows: ReportData['breakdown'],
  limit: number,
): ReportData['breakdown'] {
  const total = rows.reduce((s, r) => s + r.cost, 0);
  rows.sort((a, b) => b.cost - a.cost);
  const top = rows.slice(0, Math.max(1, limit));
  if (total > 0) for (const r of top) r.share = r.cost / total;
  return top;
}

function withinSrcAndFilters(
  rec: AssistantRecord,
  opts: AggregateOpts,
  o: ReportOptions,
): boolean {
  if (rec.source !== opts.source) return false;
  if (opts.from && rec.timestamp < opts.from.toISOString()) return false;
  if (opts.to && rec.timestamp > opts.to.toISOString()) return false;
  if (o.model && !rec.model.toLowerCase().includes(o.model.toLowerCase())) return false;
  if (o.project) {
    const needle = o.project.toLowerCase();
    const cwd = (rec.cwd || '').toLowerCase();
    const leaf = cwd.split(/[/\\]+/).pop() ?? '';
    if (!cwd.includes(needle) && !leaf.includes(needle)) return false;
  }
  return true;
}

function resolveRange(o: ReportOptions): { from: Date | null; until: Date | null } {
  if (o.since || o.until) {
    return {
      from: o.since ? parseReportDate(o.since, 'since') : null,
      until: o.until ? parseReportDate(o.until, 'until') : null,
    };
  }
  const r = o.range === 'today' ? '1d' : o.range;
  if (!isUsageRange(r)) {
    throw new Error(invalidOptionMessage('range', o.range, REPORT_RANGES));
  }
  const d = rangeToDates(r);
  return { from: d.from ?? null, until: d.to ?? null };
}

function parseReportDate(raw: string, boundary: 'since' | 'until'): Date {
  const m = raw.match(DATE_ONLY_RE);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const date =
      boundary === 'since'
        ? new Date(year, month - 1, day, 0, 0, 0, 0)
        : new Date(year, month - 1, day, 23, 59, 59, 999);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new Error(`invalid ${boundary} date: ${raw}`);
    }
    return date;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid ${boundary} date: ${raw}`);
  }
  return date;
}

// ---------- pretty rendering ----------

type C = (s: string | number) => string;

function makeColors(enabled: boolean) {
  const wrap = (code: string): C => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    cyan: wrap('36'),
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
    blue: wrap('34'),
    magenta: wrap('35'),
    brand: wrap('38;2;129;140;248'),
  };
}

function renderText(d: ReportData, o: ReportOptions): string {
  const c = makeColors(o.color !== false);
  const lines: string[] = [];

  // Header
  const ts = new Date(d.generatedAt).toLocaleString();
  lines.push('');
  lines.push(`${c.brand(c.bold('ccgauge'))} ${c.bold('report')}`);
  lines.push(
    c.dim(
      [
        `range: ${d.range}`,
        `source: ${d.source}`,
        `by: ${d.by}`,
        `gran: ${d.gran}`,
        `generated ${ts}`,
      ].join('  ·  '),
    ),
  );
  lines.push('');

  // Section: Tokens — paired rows so each line reads naturally L → R.
  lines.push(c.brand('▸') + ' ' + c.bold('Tokens'));
  const t = d.totals;
  const tokenRows: Array<[string, string, string, string]> = [
    ['Input', formatTokensCompact(t.input), 'Output', formatTokensCompact(t.output)],
    [
      'Cache R',
      c.green(formatTokensCompact(t.cacheRead)),
      'Cache W',
      formatTokensCompact(t.cacheWrite),
    ],
  ];
  if (t.reasoning > 0) {
    tokenRows.push(['Reasoning', c.dim(formatTokensCompact(t.reasoning)), '', '']);
  }
  tokenRows.push(['Total', c.bold(formatTokensCompact(t.total)), '', '']);
  // Convos (= turns / user prompts) is the headline activity number;
  // Requests (raw API calls) sits next to it for the LLM-savvy reader
  // who wants to know how much tool-loop fan-out is happening.
  tokenRows.push([
    'Convos',
    c.bold(t.turns.toLocaleString()),
    'Requests',
    t.requests.toLocaleString(),
  ]);
  lines.push(renderPairedKv(tokenRows, c));
  lines.push('');

  // Section: Cost
  lines.push(c.brand('▸') + ' ' + c.bold('Cost'));
  const totalInputForCache = t.input + t.cacheRead + t.cacheWrite;
  const cacheHit = totalInputForCache > 0 ? t.cacheRead / totalInputForCache : 0;
  const avgPerReq = t.requests > 0 ? t.cost / t.requests : 0;
  const costRows: Array<[string, string, string, string]> = [
    ['Total', c.bold(formatUSD(t.cost)), 'Saved by cache', c.green(formatUSD(t.saved))],
    [
      'Avg / request',
      avgPerReq < 0.01 ? `$${avgPerReq.toFixed(4)}` : formatUSD(avgPerReq),
      'Cache hit',
      c.green(formatPct(cacheHit, 1)),
    ],
  ];
  lines.push(renderPairedKv(costRows, c));
  lines.push('');

  // Section: trend
  if (o.showTrend !== false && d.trend.length > 0) {
    lines.push(c.brand('▸') + ' ' + c.bold('Trend') + ' ' + c.dim(`(${o.gran}, by cost)`));
    const maxCost = Math.max(...d.trend.map((b) => b.cost), 1e-9);
    const maxLabelLen = Math.max(...d.trend.map((b) => b.label.length));
    const maxCostStr = Math.max(...d.trend.map((b) => formatUSD(b.cost).length));
    for (const b of d.trend) {
      const bar = barString(b.cost / maxCost, 44);
      const label = b.label.padEnd(maxLabelLen);
      const cost = formatUSD(b.cost).padStart(maxCostStr);
      lines.push(`  ${c.dim(label)}  ${cost}  ${c.brand(bar)}`);
    }
    lines.push('');
  }

  // Section: breakdown
  if (o.showBreakdown !== false && d.breakdown.length > 0) {
    const dimLabel = d.by[0].toUpperCase() + d.by.slice(1);
    lines.push(
      c.brand('▸') +
        ' ' +
        c.bold(`Top ${d.breakdown.length} ${dimLabel}s`) +
        ' ' +
        c.dim('(by cost)'),
    );
    const headers = ['#', dimLabel, 'Convos', 'Reqs', 'Tokens', 'Cost', 'Share'];
    const rows = d.breakdown.map((r, i) => [
      String(i + 1),
      truncate(r.label, 28),
      r.turns.toLocaleString(),
      r.requests.toLocaleString(),
      formatTokensCompact(r.tokens),
      formatUSD(r.cost),
      formatPct(r.share, 1),
    ]);
    lines.push(renderTable(headers, rows, c, [false, false, true, true, true, true, true]));
    lines.push('');
  }

  return lines.join('\n');
}

function renderPairedKv(
  rows: Array<[string, string, string, string]>,
  c: ReturnType<typeof makeColors>,
): string {
  // Each row is [leftLabel, leftValue, rightLabel, rightValue].
  // The whole table aligns on 4 column widths.
  const w = [0, 0, 0, 0];
  for (const r of rows) for (let i = 0; i < 4; i += 1) {
    const cell = r[i];
    if (visibleLen(cell) > w[i]) w[i] = visibleLen(cell);
  }
  const lines: string[] = [];
  for (const [lk, lv, rk, rv] of rows) {
    const left = `${c.dim(padEnd(lk, w[0]))}  ${padEnd(lv, w[1])}`;
    const right = rk ? `${c.dim(padEnd(rk, w[2]))}  ${rv}` : '';
    lines.push(`  ${left}    ${right}`.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

function renderTable(
  headers: string[],
  rows: string[][],
  c: ReturnType<typeof makeColors>,
  rightAlign: boolean[],
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => visibleLen(r[i] ?? ''))),
  );
  const headLine =
    '  ' +
    headers
      .map((h, i) => (rightAlign[i] ? padStart(h, widths[i]) : padEnd(h, widths[i])))
      .map((s) => c.dim(s))
      .join('  ');
  const sepLine =
    '  ' +
    widths
      .map((w) => '─'.repeat(w))
      .map((s) => c.dim(s))
      .join('  ');
  const bodyLines = rows.map(
    (row) =>
      '  ' +
      row
        .map((cell, i) => (rightAlign[i] ? padStart(cell, widths[i]) : padEnd(cell, widths[i])))
        .join('  '),
  );
  return [headLine, sepLine, ...bodyLines].join('\n');
}

function barString(ratio: number, width: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * width);
  return '▇'.repeat(filled) + '─'.repeat(width - filled);
}

// Strip ANSI SGR escapes (ESC + [...m) when measuring visible length.
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*m', 'g');
function visibleLen(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

function padEnd(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - visibleLen(s)));
}
function padStart(s: string, w: number): string {
  return ' '.repeat(Math.max(0, w - visibleLen(s))) + s;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
