import type { AssistantRecord, UserRecord } from './types';

export const MIN_TIMED_OUTPUT_TOKENS = 50;

const MAX_START_WALK = 200;

export function generationWindowMs(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function tokensPerSecond(outputTokens: number, windowMs: number | null): number | null {
  if (windowMs === null || outputTokens < MIN_TIMED_OUTPUT_TOKENS) return null;
  return (outputTokens * 1000) / windowMs;
}

export interface TimedCall {
  generationMs: number | null;
  generationOutputTokens: number | null;
  outputSpeed: number | null;
}

export function summarizeTimedCalls(calls: readonly TimedCall[]): TimedCall {
  let ms: number | null = null;
  let tokens = 0;
  for (const c of calls) {
    if (c.generationMs !== null && c.generationOutputTokens !== null && c.outputSpeed !== null) {
      ms = (ms ?? 0) + c.generationMs;
      tokens += c.generationOutputTokens;
    }
  }
  if (ms === null) return { generationMs: null, generationOutputTokens: null, outputSpeed: null };
  return { generationMs: ms, generationOutputTokens: tokens, outputSpeed: (tokens * 1000) / ms };
}

export function generationStartOf(
  record: Pick<AssistantRecord, 'source' | 'parentUuid' | 'startTimestamp'>,
  users: Map<string, UserRecord>,
  parentMap: Record<string, string | null>,
  assistantUuids: ReadonlySet<string>,
): string | undefined {
  if (record.source === 'codex') return record.startTimestamp;
  let cur = record.parentUuid;
  for (let hops = 0; cur && hops < MAX_START_WALK; hops += 1) {
    const user = users.get(cur);
    if (user) return user.timestamp;
    if (assistantUuids.has(cur)) return undefined;
    cur = parentMap[cur] ?? null;
  }
  return undefined;
}
