import { getCachedScan } from '@/lib/data-loader/scan';
import { getAssistantUuids } from '@/lib/data-loader/derived';
import { recordsToTurnRows } from '@/lib/serialize';
import { isUsageRange, rangeToDates, parseCustomRange } from '@/lib/range';
import { resolveSource, filterBySource } from '@/lib/source';
import type { UsageTableRow, UsageTurnRow } from '@/lib/serialize';
import { isSortKey, sortTurns, type SortKey } from '@/lib/usage-query';
import { badRequest, withApiErrorHandling } from '@/lib/api/error-handler';
import { getProvider } from '@/lib/providers';
import { projectNameFromCwd } from '@/lib/utils';
import { resolveCanonicalCwd } from '@/lib/project-label';
import { joinModelRoute, matchesModel } from '@/lib/providers/codex/model-route.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Level = 'call' | 'turn';

function csvEscape(raw: unknown): string {
  let s = String(raw ?? '');
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function singleLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').trim();
}

function filterTurnsByQuery(turns: UsageTurnRow[], q: string): UsageTurnRow[] {
  if (!q) return turns;
  const needle = q.toLowerCase();
  return turns.filter(
    (t) =>
      t.userText.toLowerCase().includes(needle) ||
      t.cwd.toLowerCase().includes(needle) ||
      t.sessionId.toLowerCase().includes(needle) ||
      t.models.some((m) => m.toLowerCase().includes(needle)) ||
      t.children.some(
        (c) => !!c.modelRoute && joinModelRoute(c.model, c.modelRoute).toLowerCase().includes(needle),
      ) ||
      t.toolNames.some((tool) => tool.toLowerCase().includes(needle)),
  );
}

const speedCell = (tokensPerSec: number | null): string =>
  tokensPerSec === null ? '' : tokensPerSec.toFixed(2);

const secondsCell = (ms: number | null): string => (ms === null ? '' : (ms / 1000).toFixed(3));

function turnDurationSeconds(turn: UsageTurnRow): number {
  const startMs = new Date(turn.timestamp).getTime();
  const endMs = new Date(turn.endTimestamp).getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, Math.round((endMs - startMs) / 1000))
    : 0;
}

type CsvCell = string | number;
type CallColumn = readonly [name: string, cell: (turn: UsageTurnRow, call: UsageTableRow) => CsvCell];
type TurnColumn = readonly [name: string, cell: (turn: UsageTurnRow) => CsvCell];

const CALL_COLUMNS: readonly CallColumn[] = [
  ['turn_id', (turn) => csvEscape(turn.turnId)],
  ['turn_started_at', (turn) => csvEscape(turn.timestamp)],
  ['turn_ended_at', (turn) => csvEscape(turn.endTimestamp)],
  ['timestamp', (_turn, r) => csvEscape(r.timestamp)],
  ['source', (_turn, r) => csvEscape(r.source)],
  ['model', (_turn, r) => csvEscape(r.model)],
  ['model_short', (_turn, r) => csvEscape(getProvider(r.source).shortenModel(r.model))],
  ['model_route', (_turn, r) => csvEscape(r.modelRoute ?? '')],
  ['effort', (_turn, r) => csvEscape(r.effort ?? '')],
  ['project_name', (_turn, r) => csvEscape(r.projectLabel || projectNameFromCwd(r.cwd))],
  ['project_path', (_turn, r) => csvEscape(r.cwd)],
  ['session', (_turn, r) => csvEscape(r.sessionId)],
  ['user_prompt', (turn) => csvEscape(singleLine(turn.userText))],
  ['tool_names', (_turn, r) => csvEscape(r.toolNames.join(';'))],
  ['input_tokens', (_turn, r) => r.inputTokens],
  ['output_tokens', (_turn, r) => r.outputTokens],
  ['reasoning_tokens', (_turn, r) => r.reasoningTokens],
  ['cache_read_tokens', (_turn, r) => r.cacheReadTokens],
  ['cache_create_tokens', (_turn, r) => r.cacheCreationTokens],
  ['total_tokens', (_turn, r) => r.totalTokens],
  ['cost_usd', (_turn, r) => r.cost.toFixed(6)],
  ['unpriced', (_turn, r) => (r.unpriced ? 1 : 0)],
  ['output_tokens_per_sec', (_turn, r) => speedCell(r.outputSpeed)],
  ['generation_seconds', (_turn, r) => secondsCell(r.generationMs)],
];

const TURN_COLUMNS: readonly TurnColumn[] = [
  ['turn_id', (turn) => csvEscape(turn.turnId)],
  ['started_at', (turn) => csvEscape(turn.timestamp)],
  ['ended_at', (turn) => csvEscape(turn.endTimestamp)],
  ['duration_seconds', turnDurationSeconds],
  ['source', (turn) => csvEscape(turn.children[0]?.source ?? '')],
  ['models', (turn) => csvEscape(turn.models.join(';'))],
  ['effort', (turn) => csvEscape(turn.efforts.join(';'))],
  ['project_name', (turn) => csvEscape(turn.projectLabel || projectNameFromCwd(turn.cwd))],
  ['project_path', (turn) => csvEscape(turn.cwd)],
  ['session', (turn) => csvEscape(turn.sessionId)],
  ['user_prompt', (turn) => csvEscape(singleLine(turn.userText))],
  ['call_count', (turn) => turn.callCount],
  ['tool_names', (turn) => csvEscape(turn.toolNames.join(';'))],
  ['input_tokens', (turn) => turn.inputTokens],
  ['output_tokens', (turn) => turn.outputTokens],
  ['reasoning_tokens', (turn) => turn.reasoningTokens],
  ['cache_read_tokens', (turn) => turn.cacheReadTokens],
  ['cache_create_tokens', (turn) => turn.cacheCreationTokens],
  ['total_tokens', (turn) => turn.totalTokens],
  ['cost_usd', (turn) => turn.cost.toFixed(6)],
  ['unpriced_calls', (turn) => turn.unpricedCallCount],
  ['output_tokens_per_sec', (turn) => speedCell(turn.outputSpeed)],
  ['generation_seconds', (turn) => secondsCell(turn.generationMs)],
];

export const GET = withApiErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const source = await resolveSource(url.searchParams.get('source'));
  const rangeRaw = url.searchParams.get('range') || 'all';
  if (!isUsageRange(rangeRaw)) {
    return badRequest(`invalid range: ${rangeRaw}`, 'invalid_range');
  }
  const range = rangeRaw;
  const levelRaw = (url.searchParams.get('level') || 'call').toLowerCase();
  const level: Level = levelRaw === 'turn' ? 'turn' : 'call';
  const models = url.searchParams.get('models')?.split(',').filter(Boolean) ?? [];
  const projects = url.searchParams.get('projects')?.split(',').filter(Boolean) ?? [];
  const query = (url.searchParams.get('q') || '').trim();
  const sortRaw = url.searchParams.get('sort');
  const sortKey: SortKey = sortRaw && isSortKey(sortRaw) ? sortRaw : 'timestamp';
  const sortDir: 'asc' | 'desc' = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';

  const scan = await getCachedScan({ fresh: true });
  const sourceRecords = filterBySource(scan.records, source);
  const sourceUsers = filterBySource(scan.userRecords, source);

  let dates: { from?: Date; to?: Date };

  let customFromParam: string | null = null;
  let customToParam: string | null = null;
  if (range === 'custom') {
    customFromParam = url.searchParams.get('from');
    customToParam = url.searchParams.get('to');
    dates = parseCustomRange(customFromParam, customToParam);
    if (!dates.from) {
      return badRequest(
        'range=custom requires a valid `from` (YYYY-MM-DD)',
        'invalid_custom_range',
      );
    }
  } else {
    dates = rangeToDates(range);
  }

  const modelsSet = new Set(models);
  const filteredRecords = sourceRecords.filter((r) => {
    if (dates.from && r.timestamp < dates.from.toISOString()) return false;
    if (dates.to && r.timestamp > dates.to.toISOString()) return false;
    if (models.length && !matchesModel(modelsSet, r.model, r.modelRoute)) return false;
    if (projects.length && !projects.includes(resolveCanonicalCwd(r.cwd))) return false;
    return true;
  });

  const allTurns = recordsToTurnRows(filteredRecords, sourceUsers, scan.parentMap, getAssistantUuids(scan.records));
  const searched = filterTurnsByQuery(allTurns, query);
  const sorted = sortTurns(searched, sortKey, sortDir);
  const totalRows = sorted.reduce((s, t) => s + t.callCount, 0);

  const header = (level === 'turn' ? TURN_COLUMNS : CALL_COLUMNS).map(([name]) => name).join(',');

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let rangeLabel: string | null;
  if (range === 'all') rangeLabel = null;
  else if (range === 'custom') {
    const fromLabel = customFromParam ?? '';
    const toLabel = customToParam ?? today;
    rangeLabel = `${fromLabel}_${toLabel}`;
  } else rangeLabel = range;
  const filenameParts = [
    'ccgauge-usage',
    source,
    rangeLabel,
    level !== 'call' ? level : null,
    today,
  ].filter(Boolean);
  const filename = filenameParts.join('-') + '.csv';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const push = (line: string) => controller.enqueue(enc.encode(line + '\n'));

      try {

        controller.enqueue(enc.encode('﻿'));

        push(`# generated_at=${new Date().toISOString()}`);
        push(`# source=${source}`);
        push(`# range=${range}`);
        push(`# level=${level}`);
        if (models.length) push(`# models=${models.join(';')}`);
        if (projects.length)
          push(`# projects=${projects.map((p) => p.replace(/[,;]/g, ' ')).join(';')}`);
        if (query) push(`# search=${query.replace(/[,\n\r]/g, ' ')}`);
        push(`# turns=${sorted.length}`);
        push(`# rows=${level === 'turn' ? sorted.length : totalRows}`);
        push(header);

        if (level === 'turn') {
          for (const turn of sorted) push(TURN_COLUMNS.map(([, cell]) => cell(turn)).join(','));
        } else {
          for (const turn of sorted) {
            for (const r of turn.children) push(CALL_COLUMNS.map(([, cell]) => cell(turn, r)).join(','));
          }
        }

        controller.close();
      } catch (err) {

        const msg = (err as Error).message || 'export error';
        console.error('[ccgauge:api] /api/export/usage stream failed', (err as Error).stack || msg);
        try {
          push(`# error: export aborted: ${msg.replace(/[\n\r,]/g, ' ')}`);
        } catch {

        }
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
