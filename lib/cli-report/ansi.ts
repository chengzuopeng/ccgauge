// Shared TUI primitives for the dashboard renderer.
//
// The simpler `report` text layout has its own private color helper —
// we don't share with that one because it's tuned for a narrower
// palette (just brand + 3 accents). Dashboard needs a wider palette
// (the 4 token-type colors + dim / bold / sparkline accents).
//
// What lives here vs in libraries:
//   - Palette (chalk-backed)                ← here, so token-type colors are one import
//   - hbar / sparkline / stackedColumn      ← here, no lib equivalent for our needs
//   - Width / padding / truncate            → string-width + cli-truncate (call directly at use site)
//   - Boxes / tables                        → boxen + cli-table3 (call directly at use site)
//
// Bar / sparkline characters used here:
//   █ ▇ ▆ ▅ ▄ ▃ ▂ ▁  — descending vertical bar segments (1/8 → 8/8)
//   ▎▍▌▋▊▉█           — horizontal bar segments (1/8 → 8/8)
//   ▁▂▃▄▅▆▇█           — sparkline density levels

import chalk, { Chalk, type ChalkInstance } from 'chalk';
import stringWidth from 'string-width';

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

// 24-bit truecolor codes mirroring the dashboard's chart palette.
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

/**
 * Build a chalk-backed palette honoring the caller's color preference.
 *
 * We always pin the instance to chalk level 3 (truecolor) when colour
 * is on. Why force, not auto-detect?
 *  - Every entry in `RGB` above is a 24-bit colour designed to match the
 *    web dashboard's `--chart-*` CSS vars. If chalk auto-detects only
 *    16-colour support (which it does in many bundled / non-TTY
 *    parents — Claude Code shells, CI matrices, …), it crushes our
 *    palette down to bright-cyan / bright-white / etc., which look
 *    nothing like the intended brand colours.
 *  - boxen / cli-table3 also use chalk under the hood — pinning level
 *    here makes their borders honour our gray hex too.
 *  - The pre-refactor version hardcoded `\x1b[38;2;...m` truecolor
 *    escapes regardless of terminal, so this restores that behaviour
 *    in the rare 16-colour terminal at the cost of a few wasted
 *    escape bytes.
 *
 * When `useColor` is false we still construct a chalk Instance, but
 * with level 0 — every helper then returns plain strings, which keeps
 * CI / `--no-color` output grep-friendly.
 */
export function makePalette(useColor: boolean): Palette {
  const k: ChalkInstance = new Chalk({ level: useColor ? 3 : 0 });
  const fg = (rgb: readonly [number, number, number]) =>
    useColor ? (s: string) => k.rgb(rgb[0], rgb[1], rgb[2])(s) : (s: string) => s;
  return {
    reset: useColor ? '\x1b[0m' : '',
    bold: (s) => k.bold(s),
    dim: (s) => k.dim(s),
    brand: fg(RGB.brand),
    green: fg(RGB.green),
    red: fg(RGB.red),
    yellow: fg(RGB.yellow),
    cyan: fg(RGB.cyan),
    input: fg(RGB.input),
    cacheWrite: fg(RGB.cacheWrite),
    cacheRead: fg(RGB.cacheRead),
    output: fg(RGB.output),
  };
}

// ── width / padding (string-width backed) ────────────────────────────

/** Visual width in cells. Handles ANSI escapes, emoji, CJK. */
export function visibleLen(s: string): number {
  return stringWidth(s);
}

export function padEnd(s: string, w: number, fill: string = ' '): string {
  const need = w - stringWidth(s);
  return need > 0 ? s + fill.repeat(need) : s;
}

export function padStart(s: string, w: number, fill: string = ' '): string {
  const need = w - stringWidth(s);
  return need > 0 ? fill.repeat(need) + s : s;
}

export function center(s: string, w: number, fill: string = ' '): string {
  const need = w - stringWidth(s);
  if (need <= 0) return s;
  const l = Math.floor(need / 2);
  const r = need - l;
  return fill.repeat(l) + s + fill.repeat(r);
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
 *  Sub-cell precision: 1/8. A segment that takes 2.6 cells renders as
 *  `[█, █, ▅]` bottom-to-top in its colour. */
export function stackedColumn(
  segments: Array<{ value: number; color?: (s: string) => string }>,
  height: number,
  maxValue: number,
): string[] {
  const lines = new Array(height).fill(' ');
  if (height <= 0 || maxValue <= 0) return lines;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return lines;
  const totalUnits = (total / maxValue) * height * 8;
  const cap = height * 8;
  const used = Math.min(totalUnits, cap);
  let remaining = used;
  let cursorUnits = 0;

  for (const seg of segments) {
    if (seg.value <= 0 || remaining <= 0) continue;
    const segUnits = Math.min(remaining, (seg.value / total) * used);
    const startUnits = cursorUnits;
    const endUnits = cursorUnits + segUnits;
    const startRow = Math.floor(startUnits / 8);
    const endRow = Math.min(height - 1, Math.floor((endUnits - 0.0001) / 8));
    for (let row = startRow; row <= endRow; row += 1) {
      const rowBottom = row * 8;
      const fillBottom = Math.max(0, startUnits - rowBottom);
      const fillTop = Math.min(8, endUnits - rowBottom);
      let ch: string;
      if (fillTop >= 8) {
        ch = '█';
      } else if (fillBottom <= 0) {
        const idx = Math.max(1, Math.round(fillTop));
        ch = VBAR_CHARS[Math.min(8, idx)] || '▁';
      } else {
        // Segment is sandwiched in the middle of this cell — block chars
        // can't draw a hollow stripe so we render a full block; the
        // colour switch on adjacent cells still communicates the
        // boundary.
        ch = '█';
      }
      lines[height - 1 - row] = seg.color ? seg.color(ch) : ch;
    }
    remaining -= segUnits;
    cursorUnits = endUnits;
  }
  return lines;
}
