
import type { AssistantRecord, UserRecord } from '../types';

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

  const stats: LinkSidechainStats = {
    subagentFiles: 0,
    relinked: 0,
    orphans: 0,
    alreadyLinked: 0,
  };
  const seenFiles = new Set<string>();

  // Every unparented sidechain user is anchored, not just the first per file.
  // Claude's later sidechain users are tool results that already carry a parent
  // (so they short-circuit as `alreadyLinked`), but one Codex sub-agent thread
  // holds several independent `user_message` turns — anchoring only the first
  // would leave the rest stranded as top-level rows.
  for (const u of userRecords) {
    if (!u.isSidechain) continue;

    // Claude states the spawning session in the transcript PATH; Codex states
    // it in session_meta, which the parser stamps onto the record.
    const parentSessionId = extractParentSessionFromSubagentPath(u.filePath) ?? u.parentSessionId;
    if (!parentSessionId) continue;

    if (!seenFiles.has(u.filePath)) {
      seenFiles.add(u.filePath);
      stats.subagentFiles += 1;
    }

    const existingParent = parentMap[u.uuid];
    if (existingParent !== null && existingParent !== undefined) {
      stats.alreadyLinked += 1;
      continue;
    }

    const parentAssistants = parentAssistantsBySession.get(parentSessionId);
    if (!parentAssistants || parentAssistants.length === 0) {
      stats.orphans += 1;
      continue;
    }

    const t0 = u.timestamp;
    let anchor: AssistantRecord | undefined;
    for (let i = parentAssistants.length - 1; i >= 0; i -= 1) {
      if (parentAssistants[i].timestamp <= t0) {
        anchor = parentAssistants[i];
        break;
      }
    }

    if (!anchor) anchor = parentAssistants[0];

    parentMap[u.uuid] = anchor.uuid;
    stats.relinked += 1;
  }

  return stats;
}
