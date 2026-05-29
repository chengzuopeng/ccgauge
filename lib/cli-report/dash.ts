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

export function renderDash(
  scan: ScanResult,
  data: ReportData,
  opts: ReportOptions,
  filteredRecords: AssistantRecord[],
): string {
  const width = opts.width ?? process.stdout.columns ?? 100;
  const useColor = opts.color !== false;

  chalk.level = useColor ? 3 : 0;
  const c = makePalette(useColor);

  if (width < 80) {
    return [
      `[ccgauge] terminal width (${width}) is below the dashboard's 80-column floor.`,
      `Resize wider for the rich layout, or omit --dashboard for the standard report.`,
      '',
      ...renderText(data, opts).split('\n'),
    ].join('\n');
  }

  const inner = width - 4;
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

  return lines.map((l) => '  ' + l).join('\n');
}

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

function layoutTiles(tiles: TileSpec[], c: Palette, w: number): string[] {
  const tileInner = 22;
  const tileOuter = tileInner + 4;
  const gap = 1;
  const perRow = Math.max(1, Math.floor((w + gap) / (tileOuter + gap)));
  const out: string[] = [];
  for (let i = 0; i < tiles.length; i += perRow) {
    const slice = tiles.slice(i, i + perRow);
    const blocks = slice.map((t) => renderTile(t, tileInner, c));
    out.push(...mergeHorizontally(blocks, gap).split('\n'));
    if (i + perRow < tiles.length) out.push('');
  }
  return out;
}

function renderTile(t: TileSpec, inner: number, c: Palette): string {

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
    borderColor: '#5a5a64',
    width: inner + 4,
    textAlignment: 'left',
  });
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

function renderBreakdowns(c: Palette, w: number, data: ReportData): string[] {
  const primary = data.breakdown.slice(0, 8);

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
      head: [],
      border: ['gray'],
      'padding-left': 1,
      'padding-right': 1,
    },
    chars: {
      top: '─', 'top-mid': '┬', 'top-left': '╭', 'top-right': '╮',
      bottom: '─', 'bottom-mid': '┴', 'bottom-left': '╰', 'bottom-right': '╯',
      left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
      right: '│', 'right-mid': '┤', middle: '│',
    },

    wordWrap: false,
    colAligns: ['right', 'left', 'right', 'right', 'right', 'right'],
  });

  rows.forEach((r, i) => {
    const lbl = cliTruncate(r.label, Math.max(8, innerWidth - 40));
    const ratio =
      metric === 'cost'
        ? r.cost / Math.max(1e-9, scale)
        : r.turns / Math.max(1e-9, scale);
    const barW = Math.max(8, Math.min(24, innerWidth - 40));
    const bar = hbar(ratio, barW, c.brand);

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
    const sourceDow = (dow + 1) % 7;
    const row = heat[sourceDow] ?? new Array(24).fill(0);
    const cells = row.map((v) => padStart(intensity(v), 2)).join(' ');
    lines.push(`${c.dim(padEnd(dayLabels[dow], 4))} ${cells}`);
  }
  return lines;
}

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
