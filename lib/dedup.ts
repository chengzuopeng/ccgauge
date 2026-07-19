import type { AssistantRecord } from './types';

export function dedupKey(r: AssistantRecord): string {
  const prefix = `${r.source}:`;
  if (r.messageId && r.requestId) return `${prefix}${r.messageId}::${r.requestId}`;
  if (r.messageId) return `${prefix}mid:${r.messageId}`;
  if (r.requestId) return `${prefix}req:${r.requestId}`;
  return `${prefix}uuid:${r.uuid}`;
}

export function dedupAssistantRecords(records: AssistantRecord[]): AssistantRecord[] {
  const seen = new Map<string, AssistantRecord>();
  for (const r of records) {
    const k = dedupKey(r);
    const existing = seen.get(k);
    if (!existing) {
      seen.set(k, r);
      continue;
    }
    // A streamed assistant turn is split across several records sharing
    // messageId::requestId (thinking / text / tool_use chunks). Keep the
    // earliest for usage/cost, but UNION tool_use refs across the group — the
    // survivor is often a thinking-only chunk, and dropping the other chunks'
    // tool_use ids strands the tool_results that attribute back to them
    // (they'd become "(unknown)"). See lib/aggregator/tools.ts.
    const winner = r.timestamp < existing.timestamp ? r : existing;
    const other = winner === r ? existing : r;
    seen.set(k, mergeToolUses(winner, other));
  }
  return Array.from(seen.values());
}

// Return `winner` with `other`'s tool_use refs folded in (deduped by id).
// Never mutates the inputs — source records are shared with the persisted file
// cache and reused across snapshot rebuilds, so in-place appends would
// double-count. Returns `winner` untouched when there's nothing to add.
function mergeToolUses(winner: AssistantRecord, other: AssistantRecord): AssistantRecord {
  if (!other.toolUses?.length) return winner;
  const have = new Set((winner.toolUses ?? []).map((t) => t.id));
  const add = other.toolUses.filter((t) => !have.has(t.id));
  if (!add.length) return winner;
  return { ...winner, toolUses: [...(winner.toolUses ?? []), ...add] };
}
