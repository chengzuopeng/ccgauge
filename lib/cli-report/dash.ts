import boxen from 'boxen';
import chalk from 'chalk';
import Table from 'cli-table3';
import figures from 'figures';
import cliTruncate from 'cli-truncate';

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
  hbar,
  sparkline,
  stackedColumn,
  type Palette,
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
  // boxen and cli-table3 read the global `chalk.level` to decide how
  // much colour to emit. In Claude Code / CI / non-TTY parents chalk
  // often auto-detects level 1 (16 colours), which crushes our 24-bit
  // brand colours into bright cyan/yellow lookalikes and turns the
  // boxen border-color hex (`#404046`) into basic black. Force it
  // here so all three (chalk via `c`, boxen, cli-table3) emit the
  // same truecolor sequences. The process is a one-shot CLI render,
  // so the global mutation is safe.
  chalk.level = useColor ? 3 : 0;
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

  lines.push(...renderFooter(c, filteredRecords, data, opts));

  // Indent everything 2 spaces for the visual breathing room you see
  // in the reference screenshot. The right margin "happens" because
  // every component already padded itself to `inner` width.
  return lines.map((l) => '  ' + l).join('\n');
}

// ── banner ───────────────────────────────────────────────────────────

/**
 * Top banner. A single accent line + bold title + dim meta, joined
 * with the `figures.line` rule. No box around it — the dashboard's
 * KPI tiles already shoulder the heavy framing.
 */
function renderBanner(c: Palette, w: number, data: ReportData): string[] {
  const title = `${c.brand(c.bold('ccgauge'))} ${c.dim(figures.line)} ${c.bold('dashboard')}`;
  const meta = c.dim(
    [
      `range: ${data.range}`,
      `source: ${data.source}`,
      `by: ${data.by}`,
      `generated ${new Date(data.generatedAt).toLocaleString()}`,
    ].join(`  ${figures.bullet}  `),
  );
  const titleW = visibleLen(title);
  const metaW = visibleLen(meta);
  const fill = Math.max(2, w - titleW - metaW);
  return [`${title}${' '.repeat(fill)}${meta}`];
}

// ── KPI tiles ────────────────────────────────────────────────────────

/**
 * Source-aware active 5h block lookup. See `pickActiveBlock` in the
 * earlier non-libraryised version for the full rationale — short
 * version is: claude/codex show only that provider; all prefers
 * whichever has an active block (claude > codex fallback).
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
  const cl = compute('claude');
  if (cl.block) return cl;
  const x = compute('codex');
  return x.block ? x : cl;
}

interface TileSpec {
  label: string;
  value: string;
  /** Optional sparkline or hbar drawn between value and sub. */
  spark?: string;
  sub: string;
}

function renderKpiTiles(c: Palette, w: number, scan: ScanResult, data: ReportData): string[] {
  const t = data.totals;
  const sparkTokens = data.trend.map((b) => b.tokens);
  const sparkCost = data.trend.map((b) => b.cost);
  const sparkSaved = data.trend.map((b) => Math.max(0, b.cost - b.cost * 0.95));
  const sparkConvos = data.trend.map((b) => b.turns);

  const cacheIn = t.input + t.cacheRead + t.cacheWrite;
  const cacheHit = cacheIn > 0 ? t.cacheRead / cacheIn : 0;

  // Block reads scan.records (not the filtered set) — see renderDash docstring.
  const activeBlock = pickActiveBlock(scan.records, data.source);

  const tiles: TileSpec[] = [
    {
      label: 'Total tokens',
      value: c.bold(formatTokensCompact(t.total)),
      sub: `${t.requests.toLocaleString()} reqs · ${t.turns.toLocaleString()} convs`,
      spark: sparkline(sparkTokens, 14, c.input),
    },
    {
      label: 'Cost',
      value: c.bold(formatUSD(t.cost)),
      sub: t.cost > 0 ? `${formatUSD(t.cost / Math.max(1, t.requests))} / req` : '—',
      spark: sparkline(sparkCost, 14, c.output),
    },
    {
      label: 'Cache saved',
      value: c.bold(c.green(formatUSD(t.saved))),
      sub: 'vs full input pricing',
      spark: sparkline(sparkSaved, 14, c.green),
    },
    {
      label: 'Cache hit',
      value: c.bold(c.green(formatPct(cacheHit, 0))),
      spark: hbar(cacheHit, 14, c.green),
      sub: `${formatTokensCompact(t.cacheRead)} cached`,
    },
    {
      label: 'Conversations',
      value: c.bold(t.turns.toLocaleString()),
      sub: t.requests > 0 ? `${(t.requests / Math.max(1, t.turns)).toFixed(1)} reqs/turn` : '—',
      spark: sparkline(sparkConvos, 14, c.cacheRead),
    },
    {
      label: 'Active 5h block',
      value: activeBlock?.block
        ? c.bold(formatDuration(activeBlock.remainingMs))
        : c.dim('idle'),
      spark: activeBlock?.block ? hbar(activeBlock.progress, 14, c.yellow) : undefined,
      sub: activeBlock?.block
        ? `${formatPct(activeBlock.progress, 0)} elapsed`
        : 'no active window',
    },
  ];

  return layoutTiles(tiles, c, w);
}

/** Lay tiles in a responsive grid. We aim for tile width ~26 inside
 *  the boxen frame (i.e. content area of 22 chars + 2 chars padding +
 *  2 chars borders), then fit as many per row as `width` allows. */
function layoutTiles(tiles: TileSpec[], c: Palette, w: number): string[] {
  const tileInner = 22; // chars inside boxen, accounting for its padding-x: 1
  const tileOuter = tileInner + 4; // + boxen padding (2) + borders (2)
  const gap = 1;
  const perRow = Math.max(1, Math.floor((w + gap) / (tileOuter + gap)));
  const out: string[] = [];
  for (let i = 0; i < tiles.length; i += perRow) {
    const slice = tiles.slice(i, i + perRow);
    const blocks = slice.map((t) => renderTile(t, tileInner, c));
    out.push(...mergeHorizontally(blocks, gap).split('\n'));
    if (i + perRow < tiles.length) out.push(''); // gap row between tile rows
  }
  return out;
}

function renderTile(t: TileSpec, inner: number, c: Palette): string {
  // Body: small-caps label (dim alone is enough — bold on top of dim
  // makes the ANSI sequences nest awkwardly), then the bold value,
  // a sparkline / hbar slot (always reserved so tiles in a row end
  // at the same border), then the dim sub line.
  const cap = inner;
  const body = [
    c.dim(t.label.toUpperCase()),
    '',
    cliTruncate(t.value, cap),
    t.spark ? cliTruncate(t.spark, cap) : '',
    c.dim(cliTruncate(t.sub, cap)),
  ].join('\n');

  return boxen(body, {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    borderStyle: 'round',
    borderColor: '#5a5a64', // gray-600-ish — visible on dark, soft on light
    width: inner + 4, // padding-x(1+1) + borders(1+1)
    textAlignment: 'left',
  });
}

/**
 * Merge `blocks` (each a multi-line string) side-by-side, padding the
 * shorter to the max height. `gap` columns of blank space between.
 *
 * Kept inline here (was in ansi.ts) since boxen returns one block per
 * tile and we always want consistent horizontal stacking — no other
 * call site needs this generic merge.
 */
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

function renderTrend(c: Palette, w: number, data: ReportData): string[] {
  const trend = data.trend;
  const height = 10;
  const cellWidth = Math.max(4, Math.min(8, Math.floor((w - 8) / Math.max(1, trend.length))));
  const max = Math.max(...trend.map((b) => b.input + b.output + b.cacheRead + b.cacheWrite), 1);

  const heading = `${c.brand(figures.pointerSmall)} ${c.bold('Token usage trend')}  ${c.dim(
    `(${data.gran} ${figures.bullet} stacked: input / cache-w / cache-r / output)`,
  )}`;

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
  const baseline = '─'.repeat(Math.min(w - 9, cellWidth * trend.length));
  lines.push(`${' '.repeat(7)} ${c.dim('└')}${c.dim(baseline)}`);
  const sampleLabel = trend[0]?.label ?? '';
  const labelStep = Math.max(1, Math.ceil((sampleLabel.length + 1) / cellWidth));
  const xCells: string[] = trend.map((b, i) => {
    if (i % labelStep !== 0) return ' '.repeat(cellWidth);
    const span = cellWidth * Math.min(labelStep, trend.length - i);
    return center(b.label, span);
  });
  let xLine = '';
  for (let i = 0; i < xCells.length; i += 1) {
    if (i % labelStep === 0) xLine += xCells[i];
  }
  lines.push(`${' '.repeat(8)} ${c.dim(xLine)}`);

  lines.push('');
  lines.push(
    `${' '.repeat(8)}${c.input(figures.circleFilled)} input    ${c.cacheWrite(figures.circleFilled)} cache-write    ${c.cacheRead(figures.circleFilled)} cache-read    ${c.output(figures.circleFilled)} output`,
  );
  return lines;
}

// ── breakdowns (two cli-table3 columns) ──────────────────────────────

function renderBreakdowns(c: Palette, w: number, data: ReportData): string[] {
  const primary = data.breakdown.slice(0, 8);

  // Two columns, each gets half the available width minus a gap.
  const colW = Math.floor((w - 2) / 2);
  const left = renderBreakdownColumn(
    c,
    colW,
    `Top ${data.by}s by cost`,
    primary,
    'cost',
    data.totals.cost,
  );
  const right = renderBreakdownColumn(
    c,
    colW,
    `Top ${data.by}s by conversations`,
    primary.slice().sort((a, b) => b.turns - a.turns).slice(0, 8),
    'turns',
    Math.max(1, ...primary.map((r) => r.turns)),
  );
  return mergeHorizontally([left, right], 2).split('\n');
}

function renderBreakdownColumn(
  c: Palette,
  innerWidth: number,
  title: string,
  rows: ReportData['breakdown'],
  metric: 'cost' | 'turns',
  scale: number,
): string {
  // The bar column sits in its own cell so cli-table3 can keep the
  // numeric columns aligned right. We render the bar inline (with the
  // ratio bar character set) instead of as a separate row, which gives
  // the breakdown a tighter, more spreadsheet-like feel.
  const heading = `${c.brand(figures.pointerSmall)} ${c.bold(title)}`;

  if (rows.length === 0) {
    return [heading, c.dim('  (no data in this window)')].join('\n');
  }

  const table = new Table({
    head: [
      c.dim('#'),
      c.dim('Item'),
      c.dim('Conv'),
      c.dim('Reqs'),
      c.dim('Tokens'),
      c.dim('Cost'),
    ],
    style: {
      head: [],          // chalk has already coloured the cells
      border: ['gray'],  // cli-table3 maps this to chalk.gray
      'padding-left': 1,
      'padding-right': 1,
    },
    chars: {
      top: '─', 'top-mid': '┬', 'top-left': '╭', 'top-right': '╮',
      bottom: '─', 'bottom-mid': '┴', 'bottom-left': '╰', 'bottom-right': '╯',
      left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
      right: '│', 'right-mid': '┤', middle: '│',
    },
    // cli-table3 also takes per-column widths; we leave them undefined
    // so the lib auto-sizes from content. The container's truncate
    // ensures we don't overflow `innerWidth` on small terms.
    wordWrap: false,
    colAligns: ['right', 'left', 'right', 'right', 'right', 'right'],
  });

  // Reserve room for the bar row under each name. We compute one bar
  // per row and emit it as a second cell-row beneath the data row.
  rows.forEach((r, i) => {
    const lbl = cliTruncate(r.label, Math.max(8, innerWidth - 40));
    const ratio =
      metric === 'cost'
        ? r.cost / Math.max(1e-9, scale)
        : r.turns / Math.max(1e-9, scale);
    const barW = Math.max(8, Math.min(24, innerWidth - 40));
    const bar = hbar(ratio, barW, c.brand);
    // The bar lives in the Item column on a second visual line.
    // cli-table3 supports multi-line cells via \n.
    table.push([
      String(i + 1),
      `${lbl}\n${bar}`,
      r.turns.toLocaleString(),
      r.requests.toLocaleString(),
      formatTokensCompact(r.tokens),
      formatUSD(r.cost),
    ]);
  });

  return [heading, '', table.toString()].join('\n');
}

// ── heatmap (activity by day-of-week × hour-of-day) ──────────────────

function renderHeatmap(c: Palette, w: number, records: AssistantRecord[]): string[] {
  const stats = computeActivityStats(records, { source: 'all' });
  const heat = stats.heatmap;
  const max = stats.heatmapMax;
  if (max === 0) {
    return [
      `${c.brand(figures.pointerSmall)} ${c.bold('Activity heatmap')}`,
      '',
      c.dim('  (no activity yet — start a session and re-run)'),
    ];
  }
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // Five intensity steps + an empty slot. We use a single block
  // character with five descending opacities (via chalk's dim plus
  // the brand color) so the heatmap reads like a smooth gradient
  // instead of the noisy ▢▣▤▥▦ mix of glyphs the prior version had.
  const intensity = (v: number): string => {
    if (v === 0) return c.dim('·');
    const pct = v / max;
    if (pct < 0.2) return c.input('░');
    if (pct < 0.4) return c.input('▒');
    if (pct < 0.6) return c.cacheRead('▒');
    if (pct < 0.8) return c.cacheRead('▓');
    return c.output('█');
  };
  const heading = `${c.brand(figures.pointerSmall)} ${c.bold('Activity heatmap')}  ${c.dim(
    `(local time, day-of-week × hour)`,
  )}`;
  const hourHeader =
    '     ' + Array.from({ length: 24 }, (_, h) => padStart(String(h), 2)).join(' ');
  const lines = [heading, '', c.dim(hourHeader)];
  for (let dow = 0; dow < 7; dow += 1) {
    const sourceDow = (dow + 1) % 7; // Mon=1..Sun=0
    const row = heat[sourceDow] ?? new Array(24).fill(0);
    const cells = row.map((v) => padStart(intensity(v), 2)).join(' ');
    lines.push(`${c.dim(padEnd(dayLabels[dow], 4))} ${cells}`);
  }
  return lines;
}

// ── footer ───────────────────────────────────────────────────────────

function renderFooter(
  c: Palette,
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
  const scope = [
    `range: ${data.range}`,
    `source: ${data.source}`,
    `scope: ${records.length.toLocaleString()} records · ${data.totals.turns.toLocaleString()} conversations`,
  ];
  if (filters.length > 0) scope.push(`filters: ${filters.join(', ')}`);

  return [
    c.dim(scope.join(`  ${figures.bullet}  `)),
    c.dim(
      `${figures.info} Use ${c.cyan('`ccgauge report`')} for a CI-friendly text summary, or ${c.cyan('`ccgauge report -d --json`')} to pipe.`,
    ),
  ];
}
