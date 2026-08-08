
import type { AssistantRecord, UserRecord } from '../types';
import type { SpawnedSessionLink } from '../providers/types';

// Claude Code stores sub-agent transcripts under the parent session's
// `subagents/` dir. Two layouts exist:
//   - Plain Task sub-agents:  <parentSessionId>/subagents/agent-<id>.jsonl
//   - Workflow (ultracode) sub-agents, which nest one or more dirs in
//     between: <parentSessionId>/subagents/workflows/wf_<id>/agent-<id>.jsonl
// The `(?:[^\\/]+[\\/])*` allows zero or more intermediate segments so
// BOTH layouts (and any future nesting) resolve back to the parent
// session. Without it, workflow sub-agents never link to their
// triggering turn, so every parallel agent shows up as its own
// "(no user text)" row instead of folding into the one conversation
// that spawned them.
//
// Separators are matched as `[\\/]` (not just `/`) so Windows paths
// (`...\subagents\...`) work too — ccgauge supports win32.
const SUBAGENT_FILE_PATTERN = /[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/]subagents[\\/](?:[^\\/]+[\\/])*agent-[^\\/]+\.jsonl$/i;

// The `subagents/workflows/` segment is the single robust discriminator
// between a Workflow (ultracode) fan-out and a plain Task sub-agent. It's
// case- and separator-tolerant. We only ever test paths under the
// controlled `~/.claude/projects` scan root, and this segment can only
// appear there when Claude Code itself wrote it, so there is no
// user-content collision vector. Case-insensitive + `[\\/]` guard against
// hex-casing / Windows-path misses.
const WORKFLOW_SEGMENT = /[\\/]subagents[\\/]workflows[\\/]/i;

export function extractParentSessionFromSubagentPath(filePath: string): string | null {
  const m = SUBAGENT_FILE_PATTERN.exec(filePath);
  return m ? m[1] : null;
}

/**
 * Classify a transcript file path as a Workflow sub-agent, a plain Task
 * sub-agent, or neither. Gated behind `SUBAGENT_FILE_PATTERN` so the
 * 'workflow' verdict is only ever returned for paths already validated as
 * a Claude sub-agent transcript under the scan root.
 *
 * Note this labels the on-disk ARTIFACT (a Workflow fan-out), not the
 * trigger — ultracode is only one of several ways to spawn a workflow
 * (`/effort ultracode`, the `workflow` keyword, "use a workflow"), and
 * the trigger is not recoverable from disk.
 */
export function detectSubagentKind(filePath: string): 'workflow' | 'task' | null {
  if (!SUBAGENT_FILE_PATTERN.test(filePath)) return null;
  return WORKFLOW_SEGMENT.test(filePath) ? 'workflow' : 'task';
}

interface LinkInputs {
  assistantRecords: AssistantRecord[];
  userRecords: UserRecord[];
  parentMap: Record<string, string | null>;
  /** Cross-file: sessions a transcript reported starting from inside a turn. */
  spawnedSessions?: SpawnedSessionLink[];
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
  spawnedSessions,
}: LinkInputs): LinkSidechainStats {

  const spawnedBy = new Map<string, string>();
  for (const s of spawnedSessions ?? []) {
    if (!spawnedBy.has(s.sessionId)) spawnedBy.set(s.sessionId, s.parentUuid);
  }

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

  const stats: LinkSidechainStats = {
    subagentFiles: 0,
    relinked: 0,
    orphans: 0,
    alreadyLinked: 0,
  };
  const seenFiles = new Set<string>();
  // The path regex is per-FILE, but this runs per-RECORD now, and one
  // transcript holds thousands. Cache it so a big Claude history pays the same
  // number of regex executions it did when this loop was once-per-file.
  const pathParentByFile = new Map<string, string | null>();

  // Anchor one unparented sub-agent record onto the spawning turn: the parent
  // thread's last assistant record at or before `rec.timestamp`.
  function anchor(rec: {
    uuid: string;
    timestamp: string;
    filePath: string;
    sessionId: string;
    parentSessionId?: string;
  }) {
    // Claude states the spawning session in the transcript PATH; Codex states
    // it in session_meta, which the parser stamps onto the record.
    let fromPath = pathParentByFile.get(rec.filePath);
    if (fromPath === undefined) {
      fromPath = extractParentSessionFromSubagentPath(rec.filePath);
      pathParentByFile.set(rec.filePath, fromPath);
    }
    const parentSessionId = fromPath ?? rec.parentSessionId;
    // Neither half of a `codex review` pair can reach its conversation on its
    // own: the launcher names no parent session, and the worker names the
    // launcher, which spends nothing and so owns no assistant to anchor onto.
    // Both resolve through the banner the spawning turn happened to log.
    //
    // The map holds every session a transcript reported starting (`codex exec`
    // children too), but it is only ever read HERE — for a sidechain record
    // whose normal anchor came up empty. A plain `codex exec` child is its own
    // conversation, is not sidechain, and so is never offered to this function.
    const spawnedByUuid = spawnedBy.get(parentSessionId || rec.sessionId);
    if (!parentSessionId && !spawnedByUuid) return;

    if (!seenFiles.has(rec.filePath)) {
      seenFiles.add(rec.filePath);
      stats.subagentFiles += 1;
    }

    const existingParent = parentMap[rec.uuid];
    if (existingParent !== null && existingParent !== undefined) {
      stats.alreadyLinked += 1;
      return;
    }

    const parentAssistants = parentSessionId
      ? parentAssistantsBySession.get(parentSessionId)
      : undefined;
    if (!parentAssistants || parentAssistants.length === 0) {
      // Falling back to the spawning turn's USER record, not an assistant: the
      // banner pins the turn, and pinning the turn is the whole point.
      if (spawnedByUuid) {
        parentMap[rec.uuid] = spawnedByUuid;
        stats.relinked += 1;
        return;
      }
      stats.orphans += 1;
      return;
    }

    let found: AssistantRecord | undefined;
    for (let i = parentAssistants.length - 1; i >= 0; i -= 1) {
      if (parentAssistants[i].timestamp <= rec.timestamp) {
        found = parentAssistants[i];
        break;
      }
    }
    if (!found) found = parentAssistants[0];

    parentMap[rec.uuid] = found.uuid;
    stats.relinked += 1;
  }

  // Every unparented sidechain user is anchored, not just the first per file.
  // Claude's later sidechain users are tool results that already carry a parent
  // (so they short-circuit as `alreadyLinked`), but one Codex sub-agent thread
  // holds several independent `user_message` turns — anchoring only the first
  // would leave the rest stranded as top-level rows.
  for (const u of userRecords) {
    if (u.isSidechain) anchor(u);
  }

  // Then any sidechain ASSISTANT still without a parent. A Codex sub-agent
  // thread can contain no user record at all — its task prompt arrives as a
  // `response_item` with role "user", not as a `user_message` event — so there
  // is nothing for the pass above to anchor and every single API call would
  // otherwise surface as its own "(no user text)" row.
  for (const a of assistantRecords) {
    if (a.isSidechain && parentMap[a.uuid] == null) anchor(a);
  }

  return stats;
}
