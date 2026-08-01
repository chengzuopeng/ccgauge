import type { AssistantRecord, ProviderId, UserRecord } from './types';

const MAX_PARENT_WALK = 5000;

export function buildTurnIndex(
  assistants: AssistantRecord[],
  users: UserRecord[],
  parentMap: Record<string, string | null>,
): Map<string, string> {
  const userTextMap = new Map<string, string>();
  // Sub-agent seed prompts. Synthetic, so they never outrank a real user turn
  // — the point of marking them is that they fold into the turn that spawned
  // them. But they're the LAST RESORT root: `buildTurnIndex` runs over the
  // range/source-filtered records while `parentMap` is unfiltered, so the walk
  // can leave the filter window (spawning turn outside the range, parent
  // transcript archived) and find no real user at all. Rooting at the seed
  // keeps the row's text instead of degrading it to "(no user text)".
  const seedTextMap = new Map<string, string>();
  for (const u of users) {
    if (!u.textPreview || !u.textPreview.trim()) continue;
    if (u.isSynthetic) {
      if (u.isSidechain) seedTextMap.set(u.uuid, u.textPreview);
      continue;
    }
    userTextMap.set(u.uuid, u.textPreview);
  }

  const result = new Map<string, string>();
  const memo = new Map<string, string>();

  function resolve(startUuid: string): string {
    const path: string[] = [];
    let cur: string | null = startUuid;
    let answer: string | null = null;
    let fallbackIdx = -1;
    let steps = 0;
    const seen = new Set<string>();
    while (cur && steps++ < MAX_PARENT_WALK) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const m = memo.get(cur);
      if (m) {
        // A cached root only outranks a seed we already passed if it is a real
        // user turn. A cached "nothing found, rooted at itself" answer must not
        // — this walk saw a seed that walk never did.
        if (fallbackIdx === -1 || userTextMap.has(m)) answer = m;
        break;
      }
      path.push(cur);
      if (userTextMap.has(cur)) {
        answer = cur;
        break;
      }
      if (fallbackIdx === -1 && seedTextMap.has(cur)) fallbackIdx = path.length - 1;
      cur = parentMap[cur] ?? null;
    }

    let memoEnd = path.length;
    if (!answer) {
      if (fallbackIdx !== -1) {
        answer = path[fallbackIdx];
        // Memoize only up to the seed. Everything past it belongs to the
        // spawning thread and roots elsewhere; stamping this answer on those
        // nodes would drag the parent's records into the sub-agent's turn.
        memoEnd = fallbackIdx + 1;
      } else {
        // No root in scope at all (the turn's user message is outside the
        // filter window). Memoize the whole path, as this has always done, so
        // the turn's records still collapse into ONE row instead of one row
        // per API call.
        answer = startUuid;
      }
    }
    for (let i = 0; i < memoEnd; i += 1) memo.set(path[i], answer);
    return answer;
  }

  for (const a of assistants) {
    result.set(a.uuid, resolve(a.uuid));
  }
  return result;
}

export interface TurnSummary {
  turnId: string;
  firstTimestamp: string;
  firstModel: string;
  cwd: string;
  sessionId: string;
  source: ProviderId;
}

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
