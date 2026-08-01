#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * Regression tests for sub-agent sidechain linking.
 *
 * The bug this guards against: a single user turn that spawns parallel
 * sub-agents (Task tool, or a Workflow / ultracode fan-out) should fold
 * ALL the sub-agent records into that one conversation turn in the usage
 * table. The linking keys off the sub-agent transcript's file path, which
 * Claude Code writes under the parent session's `subagents/` dir. There
 * are (at least) two layouts:
 *   - <parentSessionId>/subagents/agent-<id>.jsonl                 (Task)
 *   - <parentSessionId>/subagents/workflows/wf_<id>/agent-<id>.jsonl (Workflow)
 * The original regex only matched the first; workflow sub-agents fell
 * through and each became its own "(no user text)" turn row.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { extractParentSessionFromSubagentPath, linkSidechainParents, detectSubagentKind } = await import(
  join(root, 'lib/data-loader/link-sidechain.ts')
);
const { buildTurnIndex } = await import(join(root, 'lib/turns.ts'));

const SESSION = 'b7c0734e-9557-46c8-a5ed-dd0e750f40e6';
const PROJ = `/Users/x/.claude/projects/-proj/${SESSION}`;

// ── path extraction ───────────────────────────────────────────────────
{
  // Plain Task sub-agent.
  assert.equal(
    extractParentSessionFromSubagentPath(`${PROJ}/subagents/agent-a35ccdc060233d101.jsonl`),
    SESSION,
    'plain Task sub-agent path extracts parent session',
  );
  // Workflow (ultracode) sub-agent — nested under workflows/wf_<id>/.
  assert.equal(
    extractParentSessionFromSubagentPath(
      `${PROJ}/subagents/workflows/wf_bc23460e-7ca/agent-a199e2e6b926c50d6.jsonl`,
    ),
    SESSION,
    'workflow sub-agent path extracts parent session (the fixed case)',
  );
  // Deeper nesting is tolerated for forward-compat.
  assert.equal(
    extractParentSessionFromSubagentPath(`${PROJ}/subagents/a/b/c/agent-x.jsonl`),
    SESSION,
    'arbitrarily nested sub-agent path still resolves',
  );
  // Non-agent files inside subagents/ must NOT match.
  assert.equal(
    extractParentSessionFromSubagentPath(`${PROJ}/subagents/workflows/wf_bc23460e-7ca/journal.jsonl`),
    null,
    'workflow journal.jsonl is not a sub-agent transcript',
  );
  // A normal session file is not a sub-agent.
  assert.equal(
    extractParentSessionFromSubagentPath(`${PROJ}.jsonl`),
    null,
    'plain session file is not a sub-agent',
  );
  console.log('✓ path extraction: plain + workflow + nested match; journal / session files do not');
}

// ── workflow vs task classification (the "Workflow" badge signal) ─────
{
  // Workflow (ultracode) sub-agent → 'workflow'.
  assert.equal(
    detectSubagentKind(`${PROJ}/subagents/workflows/wf_bc23460e-7ca/agent-a199e2e6b926c50d6.jsonl`),
    'workflow',
    'workflow sub-agent classified as workflow',
  );
  // Plain Task sub-agent → 'task'.
  assert.equal(
    detectSubagentKind(`${PROJ}/subagents/agent-a35ccdc060233d101.jsonl`),
    'task',
    'plain Task sub-agent classified as task',
  );
  // Not a sub-agent transcript → null.
  assert.equal(detectSubagentKind(`${PROJ}.jsonl`), null, 'session file is not a sub-agent');
  assert.equal(
    detectSubagentKind(`${PROJ}/subagents/workflows/wf_bc23460e-7ca/journal.jsonl`),
    null,
    'workflow journal is not a sub-agent transcript',
  );
  // Case-insensitive: an uppercase-hex wf_ dir must still be 'workflow'
  // (the brittle proposed regex missed this — locked in here).
  assert.equal(
    detectSubagentKind(`${PROJ}/subagents/workflows/wf_3C7C971D-E7C/agent-AABBCC.jsonl`),
    'workflow',
    'uppercase-hex workflow dir still classified as workflow',
  );
  // Separator-tolerant: Windows-style backslash path must classify too.
  assert.equal(
    detectSubagentKind(
      `C:\\Users\\x\\.claude\\projects\\-proj\\${SESSION}\\subagents\\workflows\\wf_abc\\agent-aa.jsonl`,
    ),
    'workflow',
    'Windows backslash workflow path still classified as workflow',
  );
  assert.equal(
    detectSubagentKind(
      `C:\\Users\\x\\.claude\\projects\\-proj\\${SESSION}\\subagents\\agent-aa.jsonl`,
    ),
    'task',
    'Windows backslash plain Task path classified as task',
  );
  console.log('✓ detectSubagentKind: workflow vs task, case + separator tolerant');
}

// ── end-to-end: workflow sub-agent folds into the spawning turn ────────
{
  // Main session: one real user prompt + the assistant turn that fans out
  // the workflow.
  const mainUser = {
    uuid: 'user-main',
    textPreview: '接下来进行 L1 层的详细设计。请扫描仓库',
    isSynthetic: false,
    isSidechain: false,
    sessionId: SESSION,
    timestamp: '2026-06-05T14:11:20.000Z',
    filePath: `${PROJ}.jsonl`,
  };
  const mainAsst = {
    uuid: 'asst-main',
    isSidechain: false,
    sessionId: SESSION,
    timestamp: '2026-06-05T14:11:25.000Z',
  };

  // A workflow sub-agent transcript: its first record is a synthetic,
  // sidechain user with a null parent (the agent's seeded prompt), then a
  // sidechain assistant response.
  const wfFile = `${PROJ}/subagents/workflows/wf_bc23460e-7ca/agent-a199e2e6b926c50d6.jsonl`;
  const saUser = {
    uuid: 'sa-user',
    textPreview: 'You are a sub-agent. Scan the repo …',
    isSynthetic: true,
    isSidechain: true,
    sessionId: 'agent-session-xyz',
    timestamp: '2026-06-05T14:12:52.000Z',
    filePath: wfFile,
  };
  const saAsst = {
    uuid: 'sa-asst',
    isSidechain: true,
    sessionId: 'agent-session-xyz',
    timestamp: '2026-06-05T14:12:53.000Z',
  };

  const parentMap = {
    'user-main': null,
    'asst-main': 'user-main',
    'sa-user': null, // ← orphan until linked
    'sa-asst': 'sa-user',
  };

  const stats = linkSidechainParents({
    assistantRecords: [mainAsst, saAsst],
    userRecords: [mainUser, saUser],
    parentMap,
  });

  assert.equal(stats.relinked, 1, 'one workflow sub-agent file relinked');
  assert.equal(stats.orphans, 0, 'no orphans — parent session was found');
  assert.equal(parentMap['sa-user'], 'asst-main', 'sub-agent root now points at the main assistant');

  // buildTurnIndex must now collapse the sub-agent assistant into the main
  // user turn (walking sa-asst → sa-user[synthetic,skip] → asst-main → user-main).
  const index = buildTurnIndex([mainAsst, saAsst], [mainUser, saUser], parentMap);
  assert.equal(index.get('asst-main'), 'user-main', 'main assistant roots at the user turn');
  assert.equal(
    index.get('sa-asst'),
    'user-main',
    'workflow sub-agent folds into the spawning user turn (the bug fix)',
  );
  console.log('✓ end-to-end: a workflow sub-agent folds into the turn that spawned it');
}

// ── N>1 fan-out: many sub-agents fold into ONE turn; count = distinct
//    WORKFLOW files ──────────────────────────────────────────────────────
// The headline 1.1.3 deliverable is the "Workflow ×N" badge. In serialize.ts
// N is `workflowFilesByTurn.get(turnId).size` over records where
// `isWorkflowSubagent` (stamped by the indexer via detectSubagentKind). That
// count reduces to: among the sub-agents that fold into one turn, how many
// DISTINCT workflow transcript files are there. This test reproduces exactly
// that reduction with the loadable modules (serialize.ts can't be imported
// under `node --experimental-strip-types` — it uses extensionless TS imports),
// covering the multi-file fold + the workflow-vs-Task distinction the badge
// depends on.
{
  const mainFile = `${PROJ}.jsonl`;
  const wfA = `${PROJ}/subagents/workflows/wf_aaa/agent-1.jsonl`;
  const wfB = `${PROJ}/subagents/workflows/wf_bbb/agent-2.jsonl`;
  const taskF = `${PROJ}/subagents/agent-3.jsonl`;

  const uMain = {
    uuid: 'u-main',
    textPreview: 'spawn the fan-out',
    isSynthetic: false,
    isSidechain: false,
    sessionId: SESSION,
    timestamp: '2026-06-05T10:00:00.000Z',
    filePath: mainFile,
  };
  const aMain = {
    uuid: 'a-main',
    isSidechain: false,
    sessionId: SESSION,
    timestamp: '2026-06-05T10:00:01.000Z',
    filePath: mainFile,
  };
  // Each sub-agent file: a synthetic sidechain seed user (null parent) + a
  // sidechain assistant.
  const subagent = (uid, aid, file, ts) => [
    { uuid: uid, textPreview: 'sub-agent seed', isSynthetic: true, isSidechain: true, sessionId: `s-${uid}`, timestamp: ts, filePath: file },
    { uuid: aid, isSidechain: true, sessionId: `s-${uid}`, timestamp: ts, filePath: file },
  ];
  const [uAu, aAu] = subagent('u-a', 'a-a', wfA, '2026-06-05T10:00:03.000Z');
  const [uBu, aBu] = subagent('u-b', 'a-b', wfB, '2026-06-05T10:00:03.500Z');
  const [uTu, aTu] = subagent('u-t', 'a-t', taskF, '2026-06-05T10:00:03.700Z');

  const parentMap = {
    'u-main': null,
    'a-main': 'u-main',
    'u-a': null,
    'a-a': 'u-a',
    'u-b': null,
    'a-b': 'u-b',
    'u-t': null,
    'a-t': 'u-t',
  };
  const assistants = [aMain, aAu, aBu, aTu];
  const users = [uMain, uAu, uBu, uTu];

  const stats = linkSidechainParents({ assistantRecords: assistants, userRecords: users, parentMap });
  assert.equal(stats.relinked, 3, 'all three sub-agent files relinked to the spawning turn');
  assert.equal(stats.orphans, 0, 'no orphans');

  // All three sub-agents (2 workflow + 1 task) fold into the ONE spawning turn.
  const index = buildTurnIndex(assistants, users, parentMap);
  for (const a of ['a-a', 'a-b', 'a-t']) {
    assert.equal(index.get(a), 'u-main', `${a} folds into the single spawning turn`);
  }

  // The exact reduction serialize.ts performs for workflowSubagentCount:
  // distinct filePaths among records the indexer would stamp as workflow.
  const workflowFiles = new Set(
    assistants
      .filter((r) => r.isSidechain && detectSubagentKind(r.filePath) === 'workflow')
      .map((r) => r.filePath),
  );
  assert.equal(workflowFiles.size, 2, 'badge count = 2 distinct workflow files (Task sub-agent excluded)');

  console.log('✓ N>1 fan-out: 3 sub-agents fold into 1 turn; badge count = 2 distinct workflow files');
}

// ── Codex sub-agents: parent stated on the record, N turns per file ────
// Codex rollouts live in a flat `~/.codex/sessions/YYYY/MM/DD/` tree, so the
// path carries no parent — the parser stamps `parentSessionId` from
// session_meta instead. And unlike Claude, ONE Codex sub-agent thread holds
// several independent `user_message` turns (a guardian re-reviews after each
// approval), each with a null parent, so every one of them must be anchored —
// anchoring only the first left the other 5 as top-level rows.
{
  const rootSession = '019fbb48-bc45-7640-999c-874bb086ae31';
  const codexDir = '/Users/x/.codex/sessions/2026/08/01';
  const mainFile = `${codexDir}/rollout-2026-08-01T11-05-34-${rootSession}.jsonl`;
  const guardFile = `${codexDir}/rollout-2026-08-01T14-08-07-019fbbef-dd7f.jsonl`;

  const uMain = {
    uuid: 'cx-u-main',
    textPreview: '已确认，就以 TD 为准。现在请按照 td 文档，帮我完整的实现埋点功能',
    isSynthetic: false,
    sessionId: rootSession,
    timestamp: '2026-08-01T06:06:57.000Z',
    filePath: mainFile,
  };
  const aMain = {
    uuid: 'cx-a-main',
    sessionId: rootSession,
    timestamp: '2026-08-01T06:07:00.000Z',
    filePath: mainFile,
  };

  // Six guardian review passes across two files — five in one thread.
  const pass = (n, ts, file) => [
    {
      uuid: `cx-gu-${n}`,
      textPreview: 'The following is the Codex agent history …',
      isSynthetic: true,
      isSidechain: true,
      parentSessionId: rootSession,
      sessionId: 'guardian-thread',
      timestamp: ts,
      filePath: file,
    },
    {
      uuid: `cx-ga-${n}`,
      isSidechain: true,
      sessionId: 'guardian-thread',
      timestamp: ts,
      filePath: file,
    },
  ];
  const passes = [
    pass(1, '2026-08-01T06:08:15.000Z', guardFile),
    pass(2, '2026-08-01T06:27:34.000Z', guardFile),
    pass(3, '2026-08-01T06:29:52.000Z', guardFile),
    pass(4, '2026-08-01T06:30:10.000Z', guardFile),
    pass(5, '2026-08-01T06:30:50.000Z', guardFile),
    pass(6, '2026-08-01T06:33:01.000Z', `${codexDir}/rollout-2026-08-01T14-20-35-019fbbfb-45bb.jsonl`),
  ];

  const users = [uMain, ...passes.map(([u]) => u)];
  const assistants = [aMain, ...passes.map(([, a]) => a)];
  const parentMap = { 'cx-u-main': null, 'cx-a-main': 'cx-u-main' };
  for (const [u, a] of passes) {
    parentMap[u.uuid] = null;
    parentMap[a.uuid] = u.uuid;
  }

  const stats = linkSidechainParents({
    assistantRecords: assistants,
    userRecords: users,
    parentMap,
  });
  assert.equal(stats.relinked, 6, 'every guardian turn is anchored, not just the first per file');
  assert.equal(stats.orphans, 0, 'parent resolved from parentSessionId, not from the path');
  assert.equal(stats.subagentFiles, 2, 'file count stays per-file even with 5 turns in one file');

  const index = buildTurnIndex(assistants, users, parentMap);
  assert.equal(index.get('cx-a-main'), 'cx-u-main');
  for (const [, a] of passes) {
    assert.equal(index.get(a.uuid), 'cx-u-main', `${a.uuid} folds into the spawning conversation turn`);
  }

  // A sub-agent whose parent rollout is missing stays an orphan rather than
  // being mis-anchored onto an unrelated conversation.
  const orphanMap = { 'cx-orphan-u': null, 'cx-orphan-a': 'cx-orphan-u' };
  const orphanStats = linkSidechainParents({
    assistantRecords: [{ uuid: 'cx-orphan-a', isSidechain: true, sessionId: 'g2', timestamp: '2026-08-01T06:08:15.000Z', filePath: guardFile }],
    userRecords: [{
      uuid: 'cx-orphan-u',
      textPreview: 'seed',
      isSynthetic: true,
      isSidechain: true,
      parentSessionId: 'session-not-on-disk',
      sessionId: 'g2',
      timestamp: '2026-08-01T06:08:15.000Z',
      filePath: guardFile,
    }],
    parentMap: orphanMap,
  });
  assert.equal(orphanStats.orphans, 1, 'unknown parent session → orphan, never a wrong anchor');
  assert.equal(orphanMap['cx-orphan-u'], null, 'orphan parent link left untouched');

  console.log('✓ codex sub-agents: parentSessionId anchoring, all N turns per file, orphan safety');
}

console.log('\nAll sidechain-linking assertions passed.');
