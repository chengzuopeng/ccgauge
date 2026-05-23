import { getCachedScan } from '@/lib/data-loader/scan';
import { recordsToTurnRows } from '@/lib/serialize';
import { isUsageRange, rangeToDates, parseCustomRange } from '@/lib/range';
import { resolveSource, filterBySource } from '@/lib/source';
import type { UsageTableRow, UsageTurnRow } from '@/lib/serialize';
import { isSortKey, type SortKey } from '@/lib/usage-query';
import { badRequest, withApiErrorHandling } from '@/lib/api/error-handler';
import { getProvider } from '@/lib/providers';
import { projectNameFromCwd } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Level = 'call' | 'turn';

/**
 * RFC 4180 escape + Excel formula-injection guard. If a cell starts with
 * `=`, `+`, `-`, `@`, `\t`, or `\r`, spreadsheet apps may parse it as a
 * formula. We prefix a single quote to neutralize it. Numbers are
 * stringified by callers.
 */
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

/** Strip newlines / control chars from a free-text field (prompt, tool list, etc.). */
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
    // Mirror the dashboard: "time" sort uses the turn START timestamp.
    const av = key === 'timestamp' ? a.timestamp : (a[key] as number);
    const bv = key === 'timestamp' ? b.timestamp : (b[key] as number);
    if (av === bv) return 0;
    return (dir === 'asc' ? 1 : -1) * (av < bv ? -1 : 1);
  });
  return arr;
}

// ---------- column sets ----------
//
// level=call: one row per assistant API call (the table's "expanded child" rows)
// level=turn: one row per conversation turn (the table's grouped parent rows)

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
    csvEscape(turn.children[0]?.source ?? ''),  // every turn has ≥1 child by construction
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
  // Custom range pulls bounds from ?from / ?to (YYYY-MM-DD). Same
  // contract as the /api/usage route — require `from` to be valid so
  // export never silently dumps an unbounded dataset.
  let dates: { from?: Date; to?: Date };
  // Keep the raw URL strings around — the filename label uses them
  // (not `dates.from`) so non-UTC machines don't shift the day by one
  // via `toISOString()`.
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
    if (projects.length && !projects.includes(r.cwd)) return false;
    return true;
  });

  const allTurns = recordsToTurnRows(filteredRecords, sourceUsers, scan.parentMap);
  const searched = filterTurnsByQuery(allTurns, query);
  const sorted = sortTurns(searched, sortKey, sortDir);
  const totalRows = sorted.reduce((s, t) => s + t.callCount, 0);

  const headers = level === 'turn' ? TURN_COLUMNS : CALL_COLUMNS;
  // `today` for the filename suffix: local YYYY-MM-DD, so the filename
  // matches the day the user clicked Export regardless of timezone.
  // (Plain `toISOString().slice(0, 10)` would render the next/previous
  // day for anyone east/west of UTC near midnight.)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // Filename: `ccgauge-usage-{source}-{range}-{level}-{date}.csv`
  // Range is included only when not 'all' to keep the common case short.
  // For `range=custom` we substitute the literal `from`..`to` the user
  // sent over the URL. We deliberately do NOT re-derive these from
  // `dates.from` / `dates.to` — those are local-midnight Date objects
  // that, when round-tripped through `toISOString()`, shift the day by
  // ±1 anywhere outside UTC (e.g. Asia/Shanghai's 2026-05-22 00:00
  // serialises as `2026-05-21T16:00:00.000Z`). Echoing the raw params
  // also makes the filename match what the user typed in the picker.
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
        // UTF-8 BOM so Excel (Win/Mac) opens this with the right encoding
        // and shows Chinese / emoji correctly. LibreOffice / Numbers / sheets
        // ignore the BOM cleanly.
        controller.enqueue(enc.encode('﻿'));

        // Metadata header. NOTE: `#` is NOT a standard CSV comment prefix —
        // Excel and Google Sheets will render these as ordinary cells in
        // column A and push the real header row down. Programmatic readers
        // (pandas, csvkit, etc.) can be told to skip lines starting with `#`.
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
        // Mid-stream errors can't switch to a JSON 500 (headers are already
        // sent), but we surface a comment line + abort so the user sees
        // why the file is truncated and the server gets a logged stack.
        const msg = (err as Error).message || 'export error';
        console.error('[ccgauge:api] /api/export/usage stream failed', (err as Error).stack || msg);
        try {
          push(`# error: export aborted: ${msg.replace(/[\n\r,]/g, ' ')}`);
        } catch {
          // ignore double-fault
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
