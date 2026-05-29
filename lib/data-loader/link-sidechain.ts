
import type { AssistantRecord, UserRecord } from '../types';

const SUBAGENT_FILE_PATTERN = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/subagents\/agent-[^/]+\.jsonl$/i;

export function extractParentSessionFromSubagentPath(filePath: string): string | null {
  const m = SUBAGENT_FILE_PATTERN.exec(filePath);
  return m ? m[1] : null;
}

interface LinkInputs {
  assistantRecords: AssistantRecord[];
  userRecords: UserRecord[];
  parentMap: Record<string, string | null>;
}

export interface LinkSidechainStats {

  subagentFiles: number;

  relinked: number;

  orphans: number;

  alreadyLinked: number;
}

export function linkSidechainParents({
  assistantRecords,
  userRecords,
  parentMap,
}: LinkInputs): LinkSidechainStats {

  const parentAssistantsBySession = new Map<string, AssistantRecord[]>();
  for (const a of assistantRecords) {
    if (a.isSidechain) continue;
    if (!a.sessionId) continue;
    let list = parentAssistantsBySession.get(a.sessionId);
    if (!list) {
      list = [];
      parentAssistantsBySession.set(a.sessionId, list);
    }
    list.push(a);
  }

  for (const list of parentAssistantsBySession.values()) {
    list.sort((x, y) => (x.timestamp < y.timestamp ? -1 : x.timestamp > y.timestamp ? 1 : 0));
  }

  const firstSidechainUserByFile = new Map<string, UserRecord>();
  for (const u of userRecords) {
    if (!u.isSidechain) continue;
    const existing = firstSidechainUserByFile.get(u.filePath);
    if (!existing || u.timestamp < existing.timestamp) {
      firstSidechainUserByFile.set(u.filePath, u);
    }
  }

  const stats: LinkSidechainStats = {
    subagentFiles: 0,
    relinked: 0,
    orphans: 0,
    alreadyLinked: 0,
  };

  for (const [filePath, firstUser] of firstSidechainUserByFile) {
    const parentSessionId = extractParentSessionFromSubagentPath(filePath);
    if (!parentSessionId) continue;
    stats.subagentFiles += 1;

    const existingParent = parentMap[firstUser.uuid];
    if (existingParent !== null && existingParent !== undefined) {
      stats.alreadyLinked += 1;
      continue;
    }

    const parentAssistants = parentAssistantsBySession.get(parentSessionId);
    if (!parentAssistants || parentAssistants.length === 0) {
      stats.orphans += 1;
      continue;
    }

    const t0 = firstUser.timestamp;
    let anchor: AssistantRecord | undefined;
    for (let i = parentAssistants.length - 1; i >= 0; i -= 1) {
      if (parentAssistants[i].timestamp <= t0) {
        anchor = parentAssistants[i];
        break;
      }
    }

    if (!anchor) anchor = parentAssistants[0];

    parentMap[firstUser.uuid] = anchor.uuid;
    stats.relinked += 1;
  }

  return stats;
}
