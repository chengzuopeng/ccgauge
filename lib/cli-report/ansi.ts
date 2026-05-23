// Shared ANSI / Unicode primitives for the dashboard renderer.
//
// The plain `report` text layout uses its own private `makeColors()` —
// we don't share with that one because it's tuned for a narrower
// palette (just brand + 3 accent colors). Dashboard needs a wider set
// (the 4 token-type colors, plus dim / bold / sparkline accents) and
// helper functions that the simple report doesn't.
//
// Box-drawing and bar characters used here:
//   ┌ ─ ┐ │ └ ┘  — light single-line box
//   █ ▇ ▆ ▅ ▄ ▃ ▂ ▁  — descending bar segments (1/8 → 8/8)
//   ▎▍▌▋▊▉█  — horizontal bar segments (1/8 → 8/8)
//   ▁▂▃▄▅▆▇█  — sparkline / heatmap density levels
//
// All "visible length" math goes through `visibleLen()` so padding
// stays correct when colour is on (ANSI escapes contribute 0 width).

export interface Palette {
  reset: string;
  bold: (s: string) => string;
  dim: (s: string) => string;
  brand: (s: string) => string;
  green: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  /** Token-type colours, aligned with the web dashboard's
   *  `--chart-{input,cache-create,cache-read,output}` CSS vars. */
  input: (s: string) => string;
  cacheWrite: (s: string) => string;
  cacheRead: (s: string) => string;
  output: (s: string) => string;
}

// 24-bit truecolor codes mirroring the dashboard's chart palette
// (rgb(var(--chart-*))).
const RGB = {
  brand: [129, 140, 248] as const, // indigo-400
  green: [34, 197, 94] as const,
  red: [239, 68, 68] as const,
  yellow: [234, 179, 8] as const,
  cyan: [34, 211, 238] as const,
  input: [96, 165, 250] as const, // blue-400
  cacheWrite: [167, 139, 250] as const, // purple-400
  cacheRead: [52, 211, 153] as const, // emerald-400
  output: [251, 146, 60] as const, // orange-400
};

function fg(rgb: readonly [number, number, number], useColor: boolean): (s: string) => string {
  if (!useColor) return (s) => s;
  const prefix = `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return (s) => `${prefix}${s}\x1b[39m`;
}

function wrap(open: string, close: string, useColor: boolean): (s: string) => string {
  if (!useColor) return (s) => s;
  return (s) => `${open}${s}${close}`;
}

export function makePalette(useColor: boolean): Palette {
  return {
    reset: useColor ? '\x1b[0m' : '',
    bold: wrap('\x1b[1m', '\x1b[22m', useColor),
    dim: wrap('\x1b[2m', '\x1b[22m', useColor),
    brand: fg(RGB.brand, useColor),
    green: fg(RGB.green, useColor),
    red: fg(RGB.red, useColor),
    yellow: fg(RGB.yellow, useColor),
    cyan: fg(RGB.cyan, useColor),
    input: fg(RGB.input, useColor),
    cacheWrite: fg(RGB.cacheWrite, useColor),
    cacheRead: fg(RGB.cacheRead, useColor),
    output: fg(RGB.output, useColor),
  };
}

// ── width / padding ──────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visibleLen(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

export function padEnd(s: string, w: number, fill: string = ' '): string {
  const need = w - visibleLen(s);
  return need > 0 ? s + fill.repeat(need) : s;
}

export function padStart(s: string, w: number, fill: string = ' '): string {
  const need = w - visibleLen(s);
  return need > 0 ? fill.repeat(need) + s : s;
}

export function center(s: string, w: number, fill: string = ' '): string {
  const need = w - visibleLen(s);
  if (need <= 0) return s;
  const l = Math.floor(need / 2);
  const r = need - l;
  return fill.repeat(l) + s + fill.repeat(r);
}

/** Truncate to a visible-width cap, appending an ellipsis if cut. */
export function truncate(s: string, w: number): string {
  if (visibleLen(s) <= w) return s;
  // We don't strip ANSI here because dashboard call sites only pass
  // already-plain strings; if that assumption breaks, refactor.
  return s.slice(0, Math.max(0, w - 1)) + '…';
}

// ── horizontal bar / sparkline ───────────────────────────────────────

const HBAR_CHARS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

/** Horizontal bar filled `ratio` (0..1) of `width` columns. Sub-cell
 *  precision via the 1/8-step block characters. */
export function hbar(ratio: number, width: number, color?: (s: string) => string): string {
  if (width <= 0 || !Number.isFinite(ratio) || ratio <= 0) {
    return ' '.repeat(Math.max(0, width));
  }
  const r = Math.min(1, ratio);
  const filledCells = r * width;
  const fullCells = Math.floor(filledCells);
  const remainder = filledCells - fullCells;
  const subIdx = Math.round(remainder * 8);
  let bar = '█'.repeat(fullCells);
  if (subIdx > 0 && fullCells < width) bar += HBAR_CHARS[subIdx];
  const out = padEnd(bar, width, ' ');
  return color ? color(out) : out;
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** N-cell sparkline. `values` may be longer than `width`; sampled by
 *  bucket-averaging. Empty / all-zero input renders as flat baseline. */
export function sparkline(values: number[], width: number, color?: (s: string) => string): string {
  if (width <= 0) return '';
  if (values.length === 0) return color ? color('─'.repeat(width)) : '─'.repeat(width);
  const sampled: number[] = [];
  // Bucket-average down to `width` cells when input is longer; pad-end
  // when shorter so the latest values land flush right.
  if (values.length === width) {
    sampled.push(...values);
  } else if (values.length > width) {
    const step = values.length / width;
    for (let i = 0; i < width; i += 1) {
      const lo = Math.floor(i * step);
      const hi = Math.floor((i + 1) * step);
      let sum = 0;
      let n = 0;
      for (let j = lo; j < Math.min(hi, values.length); j += 1) { sum += values[j]; n += 1; }
      sampled.push(n > 0 ? sum / n : 0);
    }
  } else {
    const pad = width - values.length;
    for (let i = 0; i < pad; i += 1) sampled.push(0);
    sampled.push(...values);
  }
  const max = Math.max(...sampled, 0);
  if (max <= 0) {
    const flat = '─'.repeat(width);
    return color ? color(flat) : flat;
  }
  const out = sampled
    .map((v) => SPARK[Math.min(7, Math.max(0, Math.round((v / max) * 7)))])
    .join('');
  return color ? color(out) : out;
}

// ── vertical stacked bars (the trend chart's bread & butter) ─────────

const VBAR_CHARS = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Render a single column of height `height` rows, partitioned by the
 *  given coloured segments. Returns an array of `height` strings,
 *  ordered TOP TO BOTTOM (so callers can `.join('\n')` rows directly).
 *
 *  `segments` are stacked bottom-to-top in array order. Each segment
 *  reserves its proportional share of cells; remaining sub-cell
 *  fraction is rendered as a partial top character on the boundary.
 *
 *  Sub-cell precision: 1/8. We use the 1/8-step block characters
 *  (`▁▂…█`). A segment that takes 2.6 cells renders as `[█, █, ▅]`
 *  bottom-to-top in its colour.
 *
 *  Width is always **1 column** — callers compose multiple columns
 *  with their preferred gap by interleaving lines. */
export function stackedColumn(
  segments: Array<{ value: number; color?: (s: string) => string }>,
  height: number,
  maxValue: number,
): string[] {
  const lines = new Array(height).fill(' ');
  if (height <= 0 || maxValue <= 0) return lines;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return lines;
  // Each segment's cell count (in 1/8-cell units) — clamp to total
  // cells avail = height * 8 so we don't overflow the column.
  const totalUnits = (total / maxValue) * height * 8;
  const cap = height * 8;
  const used = Math.min(totalUnits, cap);
  let remaining = used;
  let cursorUnits = 0; // 0..cap, counted from bottom

  for (const seg of segments) {
    if (seg.value <= 0 || remaining <= 0) continue;
    const segUnits = Math.min(remaining, (seg.value / total) * used);
    const startUnits = cursorUnits;
    const endUnits = cursorUnits + segUnits;
    // Paint each row this segment touches.
    const startRow = Math.floor(startUnits / 8);
    const endRow = Math.min(height - 1, Math.floor((endUnits - 0.0001) / 8));
    for (let row = startRow; row <= endRow; row += 1) {
      const rowBottom = row * 8;
      const rowTop = (row + 1) * 8;
      const fillBottom = Math.max(0, startUnits - rowBottom);
      const fillTop = Math.min(8, endUnits - rowBottom);
      // We render the cell as a single character; if the segment
      // covers part of a row that an earlier segment also touched,
      // the later (upper) segment wins for now (good enough for
      // 4-segment stacks; the boundary cells are visually noisy
      // either way).
      let ch: string;
      if (fillTop >= 8) {
        // Cell completely inside this segment from bottom up.
        ch = '█';
      } else if (fillBottom <= 0) {
        // Cell starts at this segment's bottom — partial fill from
        // the bottom, height = fillTop in 1/8 units.
        const idx = Math.max(1, Math.round(fillTop));
        ch = VBAR_CHARS[Math.min(8, idx)] || '▁';
      } else {
        // Segment is sandwiched in the middle of this cell — we
        // can't draw a hollow stripe with block chars, so render
        // a full block; the colour switch on adjacent cells still
        // communicates the boundary.
        ch = '█';
      }
      lines[height - 1 - row] = seg.color ? seg.color(ch) : ch;
    }
    remaining -= segUnits;
    cursorUnits = endUnits;
  }
  return lines;
}

// ── box (light single-line) ──────────────────────────────────────────

/** Draw a box around `contentLines` of inner width `innerWidth`. The
 *  title is centred in the top border between `┌─` and `─┐`. Returns
 *  a string with `\n`. */
export function box(
  title: string,
  contentLines: string[],
  innerWidth: number,
  c: Palette,
): string {
  const titleStr = title ? ` ${title} ` : '';
  const tLen = visibleLen(titleStr);
  // Centre title within the top border.
  const beforeLen = Math.max(1, Math.floor((innerWidth - tLen) / 2));
  const afterLen = Math.max(1, innerWidth - tLen - beforeLen);
  const top = c.dim('┌' + '─'.repeat(beforeLen)) + (title ? c.bold(titleStr) : '─'.repeat(tLen)) + c.dim('─'.repeat(afterLen) + '┐');
  const bot = c.dim('└' + '─'.repeat(innerWidth) + '┘');
  const body = contentLines.map((line) => c.dim('│') + ' ' + padEnd(line, innerWidth - 2) + ' ' + c.dim('│')).join('\n');
  return [top, body, bot].join('\n');
}

// ── two-column horizontal layout ─────────────────────────────────────

/** Stack `left` and `right` blocks side-by-side, padding the shorter
 *  to the max height. `gap` columns of blank space between them. */
export function twoColumns(left: string, right: string, gap: number = 2): string {
  const ls = left.split('\n');
  const rs = right.split('\n');
  const h = Math.max(ls.length, rs.length);
  const lw = Math.max(0, ...ls.map(visibleLen));
  const sep = ' '.repeat(Math.max(1, gap));
  const out: string[] = [];
  for (let i = 0; i < h; i += 1) {
    const L = padEnd(ls[i] ?? '', lw);
    const R = rs[i] ?? '';
    out.push(L + sep + R);
  }
  return out.join('\n');
}
