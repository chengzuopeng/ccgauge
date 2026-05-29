import type { AssistantRecord, ProviderId } from '../types';

export interface ActivityStats {
  sessions: number;
  messages: number;
  totalTokens: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;

  peakHour: number;

  favoriteModel: string | null;

  heatmap: number[][];

  heatmapMax: number;

  tokenHeatmap: number[][];

  tokensSummed: number;
}

interface Opts {

  source: ProviderId | 'all';

  streakWindowDays?: number;
}

const DAY_MS = 86_400_000;

export function computeActivityStats(
  records: AssistantRecord[],
  opts: Opts,
): ActivityStats {
  const filtered =
    opts.source === 'all'
      ? records
      : records.filter((r) => r.source === opts.source);
  if (filtered.length === 0) {
    return {
      sessions: 0,
      messages: 0,
      totalTokens: 0,
      activeDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      peakHour: -1,
      favoriteModel: null,
      heatmap: emptyHeatmap(),
      heatmapMax: 0,
      tokenHeatmap: emptyHeatmap(),
      tokensSummed: 0,
    };
  }

  const sessionSet = new Set<string>();
  const dayKeys = new Set<string>();
  const hourCounts = new Array<number>(24).fill(0);
  const modelCounts = new Map<string, number>();
  const heatmap = emptyHeatmap();
  const tokenHeatmap = emptyHeatmap();
  let totalTokens = 0;
  let messages = 0;

  for (const r of filtered) {
    if (r.sessionId) sessionSet.add(r.sessionId);
    const d = new Date(r.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const dayKey = localDayKey(d);
    dayKeys.add(dayKey);
    const dow = d.getDay();
    const hour = d.getHours();
    hourCounts[hour] += 1;
    heatmap[dow][hour] += 1;
    modelCounts.set(r.model, (modelCounts.get(r.model) ?? 0) + 1);
    const u = r.usage;
    const recTokens =
      u.input_tokens +
      u.output_tokens +
      u.cache_read_input_tokens +
      u.cache_creation_input_tokens;
    tokenHeatmap[dow][hour] += recTokens;
    totalTokens += recTokens;
    messages += 1;
  }

  const peakHour = argMax(hourCounts);
  const favoriteModel = pickTopKey(modelCounts);
  const { current, longest } = computeStreaks(dayKeys, opts.streakWindowDays ?? 365);

  let heatmapMax = 0;
  for (const row of heatmap) for (const v of row) if (v > heatmapMax) heatmapMax = v;

  return {
    sessions: sessionSet.size,
    messages,
    totalTokens,
    activeDays: dayKeys.size,
    currentStreak: current,
    longestStreak: longest,
    peakHour,
    favoriteModel,
    heatmap,
    heatmapMax,
    tokenHeatmap,
    tokensSummed: totalTokens,
  };
}

function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
}

function localDayKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function argMax(arr: number[]): number {
  let bestIdx = -1;
  let best = -1;
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] > best) {
      best = arr[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

function pickTopKey(m: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = -1;
  for (const [k, v] of m) {
    if (v > bestN) {
      best = k;
      bestN = v;
    }
  }
  return best;
}

function computeStreaks(
  dayKeys: Set<string>,
  windowDays: number,
): { current: number; longest: number } {
  if (dayKeys.size === 0) return { current: 0, longest: 0 };

  const days = Array.from(dayKeys)
    .map((k) => new Date(k + 'T00:00:00').getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (days[i] - days[i - 1] === DAY_MS) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  const todayMs = atMidnight(Date.now());
  const lastDay = days[days.length - 1];
  if (todayMs - lastDay > DAY_MS) {
    return { current: 0, longest };
  }
  let cursor = lastDay;
  let current = 0;
  let scanned = 0;
  const inSet = new Set(days);
  while (scanned < windowDays && inSet.has(cursor)) {
    current += 1;
    cursor -= DAY_MS;
    scanned += 1;
  }
  return { current, longest };
}

function atMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface Reference {
  key: string;
  tokens: number;
}

const REFERENCES: Reference[] = [
  { key: 'haiku', tokens: 22 },
  { key: 'tweet', tokens: 50 },
  { key: 'littlePrince', tokens: 22_000 },
  { key: 'gatsby', tokens: 65_000 },
  { key: 'hobbit', tokens: 124_000 },
  { key: 'lotrTrilogy', tokens: 624_000 },
  { key: 'warAndPeace', tokens: 763_000 },
  { key: 'harryPotterAll', tokens: 1_430_000 },
  { key: 'encyclopediaBritannica', tokens: 57_200_000 },
  { key: 'wikipediaEn', tokens: 6_500_000_000 },
];

export interface TokenComparison {

  refKey: string;

  multiplier: number;
}

export function pickTokenComparison(totalTokens: number): TokenComparison | null {
  if (totalTokens <= 0) return null;
  let chosen: Reference | null = null;
  for (const r of REFERENCES) {
    const mult = totalTokens / r.tokens;
    if (mult >= 5) chosen = r;
  }
  if (!chosen) chosen = REFERENCES[0];
  return { refKey: chosen.key, multiplier: totalTokens / chosen.tokens };
}
