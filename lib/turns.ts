import type { AssistantRecord, ProviderId, UserRecord } from './types';

const MAX_PARENT_WALK = 5000;

export function buildTurnIndex(
  assistants: AssistantRecord[],
  users: UserRecord[],
  parentMap: Record<string, string | null>,
): Map<string, string> {
  const userTextMap = new Map<string, string>();
  for (const u of users) {
    // Synthetic user messages (skill metadata, system-reminders) still carry
    // text in textPreview so per-call displays can show them, but they must
    // not be treated as turn roots — that's what wrongly split conversations
    // in the usage table.
    if (u.isSynthetic) continue;
    if (u.textPreview && u.textPreview.trim()) userTextMap.set(u.uuid, u.textPreview);
  }

  const result = new Map<string, string>();
  const memo = new Map<string, string>();

  function resolve(startUuid: string): string {
    const path: string[] = [];
    let cur: string | null = startUuid;
    let answer: string | null = null;
    let steps = 0;
    const seen = new Set<string>();
    while (cur && steps++ < MAX_PARENT_WALK) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const m = memo.get(cur);
      if (m) {
        answer = m;
        break;
      }
      path.push(cur);
      if (userTextMap.has(cur)) {
        answer = cur;
        break;
      }
      cur = parentMap[cur] ?? null;
    }
    if (!answer) answer = startUuid;
    for (const id of path) memo.set(id, answer);
    return answer;
  }

  for (const a of assistants) {
    result.set(a.uuid, resolve(a.uuid));
  }
  return result;
}

/** Per-turn metadata derived from a (typically filtered) record slice.
 *  A "turn" is one user prompt — i.e. the unit the usage table groups by
 *  and the dashboard's overview chart counts as "Conversations". A
 *  single turn may produce dozens of `AssistantRecord`s (tool-call
 *  loops, reasoning steps, sub-agents) — all collapse to one
 *  `TurnSummary` here.
 *
 *  Each turn is attributed to:
 *  - `firstTimestamp` — the earliest record's timestamp in the slice
 *    (so chronological bucketing / "when did this conversation start"
 *    questions hit the right window);
 *  - `firstModel` / `cwd` / `sessionId` / `source` — taken from the
 *    same earliest record (a session never spans providers and rarely
 *    spans cwds in practice). */
export interface TurnSummary {
  turnId: string;
  firstTimestamp: string;
  firstModel: string;
  cwd: string;
  sessionId: string;
  source: ProviderId;
}

/** Given a filtered record slice plus the full user / parent context
 *  (we need both unfiltered because a turn root may live just outside
 *  the window — same data the dashboard's `buildTurnIndex` consumes),
 *  return one `TurnSummary` per distinct turn root represented in
 *  `records`. */
export function summarizeTurns(
  records: AssistantRecord[],
  users: UserRecord[],
  parentMap: Record<string, string | null>,
): Map<string, TurnSummary> {
  const turnIndex = buildTurnIndex(records, users, parentMap);
  const out = new Map<string, TurnSummary>();
  for (const r of records) {
    const turnId = turnIndex.get(r.uuid) ?? r.uuid;
    const existing = out.get(turnId);
    if (!existing || r.timestamp < existing.firstTimestamp) {
      out.set(turnId, {
        turnId,
        firstTimestamp: r.timestamp,
        firstModel: r.model,
        cwd: r.cwd,
        sessionId: r.sessionId,
        source: r.source,
      });
    }
  }
  return out;
}
