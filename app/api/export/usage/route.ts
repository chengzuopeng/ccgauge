import { getCachedScan } from '@/lib/data-loader/scan';
import { recordsToTurnRows } from '@/lib/serialize';
import { isUsageRange, rangeToDates, parseCustomRange } from '@/lib/range';
import { resolveSource, filterBySource } from '@/lib/source';
import type { UsageTableRow, UsageTurnRow } from '@/lib/serialize';
import { isSortKey, type SortKey } from '@/lib/usage-query';
import { badRequest, withApiErrorHandling } from '@/lib/api/error-handler';
import { getProvider } from '@/lib/providers';
import { projectNameFromCwd } from '@/lib/utils';
import { resolveCanonicalCwd } from '@/lib/project-label';

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
      t.toolNames.some((tool) => tool.toLowerCase().includes(needle)),
  );
}

function sortTurns(turns: UsageTurnRow[], key: SortKey, dir: 'asc' | 'desc'): UsageTurnRow[] {
  const arr = turns.slice();
  arr.sort((a, b) => {

    const av = key === 'timestamp' ? a.timestamp : (a[key] as number);
    const bv = key === 'timestamp' ? b.timestamp : (b[key] as number);
    if (av === bv) return 0;
    return (dir === 'asc' ? 1 : -1) * (av < bv ? -1 : 1);
  });
  return arr;
}

const CALL_COLUMNS = [
  'turn_id',
  'turn_started_at',
  'turn_ended_at',
  'timestamp',
  'source',
  'model',
  'model_short',
  'effort',
  'project_name',
  'project_path',
  'session',
  'user_prompt',
  'tool_names',
  'input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'cache_read_tokens',
  'cache_create_tokens',
  'total_tokens',
  'cost_usd',
] as const;

const TURN_COLUMNS = [
  'turn_id',
  'started_at',
  'ended_at',
  'duration_seconds',
  'source',
  'models',
  'effort',
  'project_name',
  'project_path',
  'session',
  'user_prompt',
  'call_count',
  'tool_names',
  'input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'cache_read_tokens',
  'cache_create_tokens',
  'total_tokens',
  'cost_usd',
] as const;

function renderCallRow(turn: UsageTurnRow, r: UsageTableRow): string {
  const provider = getProvider(r.source);
  return [
    csvEscape(turn.turnId),
    csvEscape(turn.timestamp),
    csvEscape(turn.endTimestamp),
    csvEscape(r.timestamp),
    csvEscape(r.source),
    csvEscape(r.model),
    csvEscape(provider.shortenModel(r.model)),
    csvEscape(r.effort ?? ''),
    csvEscape(r.projectLabel || projectNameFromCwd(r.cwd)),
    csvEscape(r.cwd),
    csvEscape(r.sessionId),
    csvEscape(singleLine(turn.userText)),
    csvEscape(r.toolNames.join(';')),
    r.inputTokens,
    r.outputTokens,
    r.reasoningTokens,
    r.cacheReadTokens,
    r.cacheCreationTokens,
    r.totalTokens,
    r.cost.toFixed(6),
  ].join(',');
}

function renderTurnRow(turn: UsageTurnRow): string {
  const startMs = new Date(turn.timestamp).getTime();
  const endMs = new Date(turn.endTimestamp).getTime();
  const durationSec = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, Math.round((endMs - startMs) / 1000))
    : 0;
  return [
    csvEscape(turn.turnId),
    csvEscape(turn.timestamp),
    csvEscape(turn.endTimestamp),
    durationSec,
    csvEscape(turn.children[0]?.source ?? ''),
    csvEscape(turn.models.join(';')),
    csvEscape(turn.efforts.join(';')),
    csvEscape(turn.projectLabel || projectNameFromCwd(turn.cwd)),
    csvEscape(turn.cwd),
    csvEscape(turn.sessionId),
    csvEscape(singleLine(turn.userText)),
    turn.callCount,
    csvEscape(turn.toolNames.join(';')),
    turn.inputTokens,
    turn.outputTokens,
    turn.reasoningTokens,
    turn.cacheReadTokens,
    turn.cacheCreationTokens,
    turn.totalTokens,
    turn.cost.toFixed(6),
  ].join(',');
}

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

  const scan = await getCachedScan();
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

  const filteredRecords = sourceRecords.filter((r) => {
    if (dates.from && r.timestamp < dates.from.toISOString()) return false;
    if (dates.to && r.timestamp > dates.to.toISOString()) return false;
    if (models.length && !models.includes(r.model)) return false;
    if (projects.length && !projects.includes(resolveCanonicalCwd(r.cwd))) return false;
    return true;
  });

  const allTurns = recordsToTurnRows(filteredRecords, sourceUsers, scan.parentMap);
  const searched = filterTurnsByQuery(allTurns, query);
  const sorted = sortTurns(searched, sortKey, sortDir);
  const totalRows = sorted.reduce((s, t) => s + t.callCount, 0);

  const headers = level === 'turn' ? TURN_COLUMNS : CALL_COLUMNS;

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
        push(headers.join(','));

        if (level === 'turn') {
          for (const turn of sorted) push(renderTurnRow(turn));
        } else {
          for (const turn of sorted) {
            for (const r of turn.children) push(renderCallRow(turn, r));
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
