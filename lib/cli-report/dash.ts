import type { AssistantRecord, ScanResult } from '@/lib/types';
import { formatTokensCompact, formatUSD, formatPct, formatDuration } from '@/lib/utils';
import { blockProgress, type BlockProgressInfo } from '@/lib/blocks/compute';
import { getProvider } from '@/lib/providers';
import { computeActivityStats } from '@/lib/aggregator/activity';
import { renderText, type ReportData, type ReportOptions } from './index';
import {
  makePalette,
  visibleLen,
  padEnd,
  padStart,
  center,
  truncate,
  hbar,
  sparkline,
  stackedColumn,
  box,
  twoColumns,
} from './ansi';

/** Public entry — `runReport(...)` calls into us when `opts.dashboard`
 *  is true. Returns the fully-rendered dashboard string (no trailing
 *  newline; the CLI adds it).
 *
 *  `filteredRecords` is the same record set the totals/trend/breakdown
 *  in `data` were derived from. Heatmap and footer scope read records
 *  directly, so passing the raw `scan.records` here would silently
 *  show activity from outside the selected window. The Active 5h block
 *  in the KPI tile row deliberately keeps `scan` access — block
 *  progress is a "right now" reading and should NOT be cropped by
 *  --range, only by --source. */
export function renderDash(
  scan: ScanResult,
  data: ReportData,
  opts: ReportOptions,
  filteredRecords: AssistantRecord[],
): string {
  const width = opts.width ?? process.stdout.columns ?? 100;
  const useColor = opts.color !== false;
  const c = makePalette(useColor);

  // Width-based degradation: too narrow → tell the user to widen, but
  // still print something useful (the trend chart + KPI tiles don't
  // fit < 80, and trying to render them just makes the output worse).
  if (width < 80) {
    return [
      `[ccgauge] terminal width (${width}) is below the dashboard's 80-column floor.`,
      `Resize wider for the rich layout, or omit --dashboard for the standard report.`,
      '',
      ...renderText(data, opts).split('\n'),
    ].join('\n');
  }

  const inner = width - 4; // 2-char left + right margin
  const lines: string[] = [];

  if (opts.banner !== false) {
    lines.push(...renderBanner(c, inner, data));
    lines.push('');
  }

  lines.push(...renderKpiTiles(c, inner, scan, data));
  lines.push('');

  if (opts.compact !== true && data.trend.length > 0) {
    lines.push(...renderTrend(c, inner, data));
    lines.push('');
  }

  lines.push(...renderBreakdowns(c, inner, data));
  lines.push('');

  lines.push(...renderHeatmap(c, inner, filteredRecords));
  lines.push('');

  lines.push(...renderFooter(c, inner, filteredRecords, data, opts));

  // Indent everything 2 spaces for the visual breathing room you see
  // in the reference screenshot. The right margin "happens" because
  // every component already padded itself to `inner` width.
  return lines.map((l) => '  ' + l).join('\n');
}

// ── banner ───────────────────────────────────────────────────────────

function renderBanner(c: ReturnType<typeof makePalette>, w: number, data: ReportData): string[] {
  const title = `${c.brand(c.bold('ccgauge'))} ${c.bold('dashboard')}`;
  const meta = c.dim(
    [
      `range: ${data.range}`,
      `source: ${data.source}`,
      `by: ${data.by}`,
      `generated ${new Date(data.generatedAt).toLocaleString()}`,
    ].join('  ·  '),
  );
  // ╭──── title ──── meta ────╮
  const titlePart = ` ${title} `;
  const metaPart = ` ${meta} `;
  const fillLen = Math.max(0, w - visibleLen(titlePart) - visibleLen(metaPart) - 2);
  const dash = c.dim('─');
  const left = c.dim('╭') + dash + titlePart + dash.repeat(Math.floor(fillLen / 2));
  const right = dash.repeat(fillLen - Math.floor(fillLen / 2)) + metaPart + dash + c.dim('╮');
  return [left + right];
}

/**
 * Source-aware active 5h block lookup.
 *
 * - `claude` / `codex`: compute that provider's block only. Returns
 *   the BlockProgressInfo regardless of whether `.block` is populated,
 *   so the tile shows "(idle)" specifically for the requested provider
 *   instead of accidentally falling through to the other one.
 * - `all`: probe claude first, then codex. Matches the web dashboard's
 *   compact view convention. (When both have active blocks, the web
 *   UI splits the panel side-by-side — TUI tile is single-cell so we
 *   pick a winner.)
 */
function pickActiveBlock(
  records: AssistantRecord[],
  source: ReportData['source'],
): BlockProgressInfo | null {
  function compute(provider: 'claude' | 'codex'): BlockProgressInfo {
    return blockProgress(
      records.filter((r) => r.source === provider),
      getProvider(provider).capabilities.blockWindowMs,
    );
  }
  if (source === 'claude') return compute('claude');
  if (source === 'codex') return compute('codex');
  // `all`: prefer whichever has an active block, falling back to
  // claude → codex order if neither (returns an `idle` block).
  const c = compute('claude');
  if (c.block) return c;
  const x = compute('codex');
  return x.block ? x : c;
}

// ── KPI tiles ────────────────────────────────────────────────────────

function renderKpiTiles(
  c: ReturnType<typeof makePalette>,
  w: number,
  scan: ScanResult,
  data: ReportData,
): string[] {
  const t = data.totals;
  // Sparkline series for the tiles (sourced from the existing trend).
  const sparkTokens = data.trend.map((b) => b.tokens);
  const sparkCost = data.trend.map((b) => b.cost);
  const sparkSaved = data.trend.map((b) => Math.max(0, b.cost - b.cost * 0.95)); // approx; we don't track per-bucket savings yet, use cost shape
  const sparkConvos = data.trend.map((b) => b.turns);

  // Cache hit ratio over the window
  const cacheIn = t.input + t.cacheRead + t.cacheWrite;
  const cacheHit = cacheIn > 0 ? t.cacheRead / cacheIn : 0;

  // Active block — respect `--source`:
  //   --source claude → only show Claude's 5h window
  //   --source codex  → only show Codex's window
  //   --source all    → prefer whichever has an active block, falling
  //                     back claude → codex (matches the web dashboard's
  //                     "first available wins" convention in compact
  //                     non-split views).
  //
  // We deliberately use `scan.records` (NOT the filtered set) here:
  // the block tile is a "right now" reading that should not be cropped
  // by --range/--model/--project filters. Doing so would let a user
  // who scoped to "last 30d" never see today's active block.
  const activeBlock = pickActiveBlock(scan.records, data.source);

  const tiles: TileSpec[] = [
    {
      label: 'Total tokens',
      value: c.bold(formatTokensCompact(t.total)),
      sub: `${t.requests.toLocaleString()} reqs · ${t.turns.toLocaleString()} convs`,
      spark: sparkline(sparkTokens, 12, c.input),
    },
    {
      label: 'Cost',
      value: c.bold(formatUSD(t.cost)),
      sub: t.cost > 0 ? `${formatUSD(t.cost / Math.max(1, t.requests))} / req` : '—',
      spark: sparkline(sparkCost, 12, c.output),
    },
    {
      label: 'Cache saved',
      value: c.bold(c.green(formatUSD(t.saved))),
      sub: `vs full input pricing`,
      spark: sparkline(sparkSaved, 12, c.green),
    },
    {
      label: 'Cache hit',
      value: c.bold(c.green(formatPct(cacheHit, 0))),
      // Render the progress bar in the sparkline slot so this tile's
      // row layout matches the others; the sub line then carries the
      // raw ratio for users who care about the exact number.
      spark: hbar(cacheHit, 12, c.green),
      sub: `${formatTokensCompact(t.cacheRead)} cached`,
    },
    {
      label: 'Conversations',
      value: c.bold(t.turns.toLocaleString()),
      sub: t.requests > 0 ? `${(t.requests / Math.max(1, t.turns)).toFixed(1)} reqs/turn` : '—',
      spark: sparkline(sparkConvos, 12, c.cacheRead),
    },
    {
      label: 'Active 5h block',
      value: activeBlock?.block
        ? c.bold(formatDuration(activeBlock.remainingMs))
        : c.dim('idle'),
      spark: activeBlock?.block ? hbar(activeBlock.progress, 12, c.yellow) : undefined,
      sub: activeBlock?.block
        ? `${formatPct(activeBlock.progress, 0)} elapsed`
        : 'no active window',
    },
  ];

  return layoutTiles(tiles, c, w);
}

interface TileSpec {
  label: string;
  value: string;
  sub: string;
  /** Optional sparkline line drawn between value and sub. */
  spark?: string;
}

/** Lay tiles in a responsive grid. We aim for tile width ~26 (= label
 *  20 + padding), then fit as many per row as `width` allows. Wraps
 *  to additional rows when needed. */
function layoutTiles(tiles: TileSpec[], c: ReturnType<typeof makePalette>, w: number): string[] {
  const tileInner = 24;       // chars inside the box
  const tileOuter = tileInner + 2; // + 2 for the box's │ characters
  const gap = 1;
  const perRow = Math.max(1, Math.floor((w + gap) / (tileOuter + gap)));
  const out: string[] = [];
  for (let i = 0; i < tiles.length; i += perRow) {
    const slice = tiles.slice(i, i + perRow);
    // Render each tile to a multi-line block, then merge them
    // horizontally with a 1-column gap. `mergeHorizontally` returns a
    // single string with `\n` between rows — we re-split so the
    // outer `lines.map((l) => '  ' + l).join('\n')` indent applies to
    // every visual row, not just the first.
    const blocks = slice.map((t) => renderTile(t, tileInner, c));
    out.push(...mergeHorizontally(blocks, gap).split('\n'));
    if (i + perRow < tiles.length) out.push(''); // gap row between tile rows
  }
  return out;
}

function renderTile(t: TileSpec, inner: number, c: ReturnType<typeof makePalette>): string {
  // Don't padEnd here: `box()` already pads each body line to
  // `innerWidth - 2` (account for the side `│` chars). Pre-padding
  // would push the row past `innerWidth` and break the `widths` math
  // in `mergeHorizontally`, producing inconsistent inter-tile gaps.
  // Likewise, truncate the sub line to `inner - 2` so it never
  // overflows — overflow would silently widen this single tile and
  // throw alignment off for the whole row.
  const cap = inner - 2;
  const body: string[] = [''];
  body.push(truncate(t.value, cap));
  // Always reserve a row for the sparkline (even when absent) so all
  // tiles in a row end at the same `└──┘`. Without the empty slot the
  // tile is 1 row shorter and the merge becomes jagged.
  body.push(t.spark ? truncate(t.spark, cap) : '');
  body.push(c.dim(truncate(t.sub, cap)));
  return box(t.label, body, inner, c);
}

function mergeHorizontally(blocks: string[], gap: number): string {
  const rows = blocks.map((b) => b.split('\n'));
  const h = Math.max(...rows.map((r) => r.length));
  const widths = rows.map((r) => Math.max(...r.map(visibleLen)));
  const sep = ' '.repeat(gap);
  const lines: string[] = [];
  for (let i = 0; i < h; i += 1) {
    const cells = rows.map((r, idx) => padEnd(r[i] ?? '', widths[idx]));
    lines.push(cells.join(sep));
  }
  return lines.join('\n');
}

// ── trend (stacked vertical bars) ────────────────────────────────────

function renderTrend(c: ReturnType<typeof makePalette>, w: number, data: ReportData): string[] {
  const trend = data.trend;
  const height = 10;
  // Each column = 4 chars wide (bar + 3 padding) so labels under
  // columns have room. With N buckets we want barWidth × N to fit.
  const cellWidth = Math.max(4, Math.min(8, Math.floor((w - 8) / Math.max(1, trend.length))));
  // Find the max stacked total across buckets for normalisation.
  const max = Math.max(...trend.map((b) => b.input + b.output + b.cacheRead + b.cacheWrite), 1);

  const heading = `${c.brand('▸')} ${c.bold('Token usage trend')} ${c.dim(
    `(${data.gran} × stacked: input / cache-w / cache-r / output)`,
  )}`;

  // Build each row top-to-bottom by joining single-character columns.
  const colsPerBucket = trend.map((b) =>
    stackedColumn(
      [
        { value: b.input, color: c.input },
        { value: b.cacheWrite, color: c.cacheWrite },
        { value: b.cacheRead, color: c.cacheRead },
        { value: b.output, color: c.output },
      ],
      height,
      max,
    ),
  );

  // Y-axis labels: 0 / mid / max
  const yLabels = [
    padStart(formatTokensCompact(max), 7),
    padStart(formatTokensCompact(max / 2), 7),
    padStart('0', 7),
  ];
  const yLabelRow = (row: number): string => {
    if (row === 0) return yLabels[0];
    if (row === Math.floor((height - 1) / 2)) return yLabels[1];
    if (row === height - 1) return yLabels[2];
    return ' '.repeat(7);
  };

  const lines: string[] = [heading, ''];
  for (let row = 0; row < height; row += 1) {
    const cells = colsPerBucket.map((col) => center(col[row], cellWidth));
    lines.push(`${c.dim(yLabelRow(row))} ${c.dim('│')} ${cells.join('')}`);
  }
  // x-axis baseline + labels.
  // When `cellWidth` is narrower than the bucket label (e.g. `MM/DD`
  // is 5 chars but 30d × ~4-char cells), drawing every label produces
  // a concatenated mess. We step the labels so each one centres on
  // its bucket and the next label has ~5 cols of breathing room.
  const baseline = '─'.repeat(Math.min(w - 9, cellWidth * trend.length));
  lines.push(`${' '.repeat(7)} ${c.dim('└')}${c.dim(baseline)}`);
  const sampleLabel = trend[0]?.label ?? '';
  const labelStep = Math.max(1, Math.ceil((sampleLabel.length + 1) / cellWidth));
  const xCells: string[] = trend.map((b, i) => {
    if (i % labelStep !== 0) return ' '.repeat(cellWidth);
    const span = cellWidth * Math.min(labelStep, trend.length - i);
    return center(b.label, span);
  });
  // Centred labels may overrun their slot when `labelStep > 1` — that's
  // fine, the overflow takes blank space we already reserved.
  let xLine = '';
  for (let i = 0; i < xCells.length; i += 1) {
    if (i % labelStep === 0) xLine += xCells[i];
  }
  lines.push(`${' '.repeat(8)} ${c.dim(xLine)}`);

  // Legend
  lines.push('');
  lines.push(
    `${' '.repeat(8)}${c.input('●')} input    ${c.cacheWrite('●')} cache-write    ${c.cacheRead('●')} cache-read    ${c.output('●')} output`,
  );
  return lines;
}

// ── breakdowns (two columns) ─────────────────────────────────────────

function renderBreakdowns(
  c: ReturnType<typeof makePalette>,
  w: number,
  data: ReportData,
): string[] {
  // The active `--by` drives the LEFT column; we always also render a
  // secondary RIGHT column with a complementary dimension so the user
  // can see model + project side-by-side without two invocations.
  // (We don't try to be clever and re-derive the right column from
  // record-level data — that would require an extra aggregation pass.
  // Instead the right column is a recomputed `breakdown` from the
  // existing data, summarised differently.)
  const primary = data.breakdown.slice(0, 10);
  const left = renderBreakdownColumn(
    c,
    Math.floor((w - 2) / 2),
    `Top ${data.by}s (by cost)`,
    primary,
    data.totals.cost,
  );

  // Stretch goal: a secondary column. For now mirror the primary so
  // visual real estate isn't wasted; future work can swap in
  // session-level or project-level views by re-aggregating.
  const right = renderBreakdownColumn(
    c,
    Math.floor((w - 2) / 2),
    `Top ${data.by}s (by conversations)`,
    primary.slice().sort((a, b) => b.turns - a.turns).slice(0, 10),
    Math.max(1, ...primary.map((r) => r.turns)),
    'turns',
  );

  return twoColumns(left, right, 2).split('\n');
}

function renderBreakdownColumn(
  c: ReturnType<typeof makePalette>,
  innerWidth: number,
  title: string,
  rows: ReportData['breakdown'],
  scale: number,
  metric: 'cost' | 'turns' = 'cost',
): string {
  const labelW = Math.max(10, Math.min(22, innerWidth - 30));
  const headers = [
    padEnd('#', 2),
    padEnd(metric === 'cost' ? 'Item' : 'Item', labelW),
    padStart('Conv', 5),
    padStart('Reqs', 6),
    padStart('Tokens', 8),
    padStart(metric === 'cost' ? 'Cost' : 'Cost', 8),
  ];
  const bodyLines: string[] = [];
  bodyLines.push(c.dim(headers.join(' ')));
  bodyLines.push(c.dim('─'.repeat(Math.min(innerWidth - 2, headers.join(' ').length))));
  if (rows.length === 0) {
    bodyLines.push(c.dim('(no data in this window)'));
  }
  rows.forEach((r, i) => {
    const lbl = truncate(r.label, labelW);
    bodyLines.push(
      [
        padEnd(String(i + 1), 2),
        padEnd(lbl, labelW),
        padStart(r.turns.toLocaleString(), 5),
        padStart(r.requests.toLocaleString(), 6),
        padStart(formatTokensCompact(r.tokens), 8),
        padStart(formatUSD(r.cost), 8),
      ].join(' '),
    );
    const ratio = metric === 'cost' ? r.cost / Math.max(1e-9, scale) : r.turns / Math.max(1e-9, scale);
    const barW = innerWidth - 4 - 2 - labelW; // leave room for "  " indent + "#  "
    bodyLines.push(`${' '.repeat(3)}${hbar(ratio, Math.max(8, Math.min(40, barW)), c.brand)}`);
  });
  return box(title, bodyLines, innerWidth, c);
}

// ── heatmap (activity by day-of-week × hour-of-day) ──────────────────

function renderHeatmap(
  c: ReturnType<typeof makePalette>,
  w: number,
  records: AssistantRecord[],
): string[] {
  // `records` here is already pre-filtered for source / range / model /
  // project (see `filterRecordsForReport`). Pass `'all'` to
  // computeActivityStats so it doesn't redundantly re-filter by source
  // — and so a `--source claude` heatmap doesn't show as empty just
  // because the helper was double-filtering.
  const stats = computeActivityStats(records, { source: 'all' });
  const heat = stats.heatmap;
  const max = stats.heatmapMax;
  if (max === 0) {
    return [`${c.brand('▸')} ${c.bold('Activity heatmap')}`, '', c.dim('  (no activity yet — start a session and re-run)')];
  }
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const density = ['·', '▢', '▣', '▤', '▥', '▦'];
  const cell = (v: number): string => {
    if (v === 0) return c.dim('·');
    const idx = Math.min(density.length - 1, Math.max(1, Math.ceil((v / max) * (density.length - 1))));
    const ch = density[idx];
    return idx < 3 ? c.input(ch) : idx < 5 ? c.cacheRead(ch) : c.output(ch);
  };
  const heading = `${c.brand('▸')} ${c.bold('Activity heatmap')} ${c.dim('(local time, day-of-week × hour)')}`;
  const hourHeader = '    ' + Array.from({ length: 24 }, (_, h) => padStart(String(h), 2)).join(' ');
  const lines = [heading, '', c.dim(hourHeader)];
  // computeActivityStats uses 0=Sunday convention; remap to Mon-first
  // for display so the heatmap reads like a calendar week.
  for (let dow = 0; dow < 7; dow += 1) {
    const sourceDow = (dow + 1) % 7; // Mon=1..Sun=0
    const row = heat[sourceDow] ?? new Array(24).fill(0);
    const cells = row.map((v) => padStart(cell(v), 2)).join(' ');
    lines.push(`${c.dim(padEnd(dayLabels[dow], 4))}${cells}`);
  }
  return lines;
}

// ── footer ───────────────────────────────────────────────────────────

function renderFooter(
  c: ReturnType<typeof makePalette>,
  w: number,
  records: AssistantRecord[],
  data: ReportData,
  opts: ReportOptions,
): string[] {
  const filters: string[] = [];
  if (opts.model) filters.push(`model~${opts.model}`);
  if (opts.project) filters.push(`project~${opts.project}`);
  if (data.fromIso || data.untilIso) {
    const range = `${data.fromIso?.slice(0, 10) ?? '…'} → ${data.untilIso?.slice(0, 10) ?? '…'}`;
    filters.push(range);
  }
  // `records.length` is the count AFTER all filters (source / range /
  // model / project) — the same set the KPI tiles / trend / heatmap
  // were built from. The earlier version printed `scan.records.length`
  // (raw scan total) which made the footer brag about 20k+ records
  // even on `report -d --range 7d --source codex` where the actual
  // counted set was ~800.
  const scope = [
    `range: ${data.range}`,
    `source: ${data.source}`,
    `scope: ${records.length.toLocaleString()} records · ${data.totals.turns.toLocaleString()} conversations`,
  ];
  if (filters.length > 0) scope.push(`filters: ${filters.join(', ')}`);
  return [
    c.dim(scope.join('  ·  ')),
    c.dim(`Use \`ccgauge report\` for a CI-friendly text summary, or \`ccgauge report -d --json\` to pipe.`),
  ];
}
