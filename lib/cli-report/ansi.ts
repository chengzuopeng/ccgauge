
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

  input: (s: string) => string;
  cacheWrite: (s: string) => string;
  cacheRead: (s: string) => string;
  output: (s: string) => string;
}

const RGB = {
  brand: [129, 140, 248] as const,
  green: [34, 197, 94] as const,
  red: [239, 68, 68] as const,
  yellow: [234, 179, 8] as const,
  cyan: [34, 211, 238] as const,
  input: [96, 165, 250] as const,
  cacheWrite: [167, 139, 250] as const,
  cacheRead: [52, 211, 153] as const,
  output: [251, 146, 60] as const,
};

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

const HBAR_CHARS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

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

const VBAR_CHARS = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

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

        ch = '█';
      }
      lines[height - 1 - row] = seg.color ? seg.color(ch) : ch;
    }
    remaining -= segUnits;
    cursorUnits = endUnits;
  }
  return lines;
}
