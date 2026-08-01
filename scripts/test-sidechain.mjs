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

// ── Codex sub-agent threads that carry NO user record ─────────────────
// Some Codex sub-agent rollouts deliver the task prompt as a `response_item`
// with role "user" instead of a `user_message` event, so the file yields zero
// UserRecords. With nothing for the user pass to anchor, every single API call
// in the thread surfaced as its own "(no user text)" row — 71 of them across
// two threads on 2026-08-01. Unparented sidechain ASSISTANTS are anchored too.
{
  const rootSession = '019fbb48-bc45-7640-999c-874bb086ae31';
  const codexDir = '/Users/x/.codex/sessions/2026/08/01';
  const mainFile = `${codexDir}/rollout-2026-08-01T11-05-34-${rootSession}.jsonl`;
  const subFile = `${codexDir}/rollout-2026-08-01T16-12-34-019fbc61-d063.jsonl`;

  const uMain = {
    uuid: 'nu-u-main',
    textPreview: '好，就按你建议，完成全部问题的修复',
    isSynthetic: false,
    sessionId: rootSession,
    timestamp: '2026-08-01T08:03:31.000Z',
    filePath: mainFile,
  };
  const aMain = {
    uuid: 'nu-a-main',
    sessionId: rootSession,
    timestamp: '2026-08-01T08:03:35.000Z',
    filePath: mainFile,
  };
  // Sub-agent thread: assistants only, every one with a null parent.
  const subAsst = ['08:12:40', '08:13:12', '08:14:31'].map((hhmmss, i) => ({
    uuid: `nu-sa-${i}`,
    isSidechain: true,
    parentSessionId: rootSession,
    sessionId: '019fbc61-d063',
    timestamp: `2026-08-01T${hhmmss}.000Z`,
    filePath: subFile,
  }));

  const parentMap = { 'nu-u-main': null, 'nu-a-main': 'nu-u-main' };
  for (const a of subAsst) parentMap[a.uuid] = null;

  const assistants = [aMain, ...subAsst];
  const users = [uMain];
  const stats = linkSidechainParents({ assistantRecords: assistants, userRecords: users, parentMap });

  assert.equal(stats.relinked, 3, 'all three userless sub-agent calls anchored');
  assert.equal(stats.subagentFiles, 1, 'counted as one sub-agent file');

  const index = buildTurnIndex(assistants, users, parentMap);
  for (const a of subAsst) {
    assert.equal(index.get(a.uuid), 'nu-u-main', `${a.uuid} folds into the spawning turn`);
  }
  console.log('✓ userless codex sub-agent thread: assistants anchored, no per-call orphan rows');
}

// ── orphan fallback: an unanchored sub-agent seed still roots a turn ───
// A sub-agent seed prompt is marked synthetic so it folds into its spawner.
// When linking can't find that spawner (parent transcript archived, or it
// produced no records) the seed must root its own turn — otherwise marking it
// synthetic is strictly worse than not linking at all: the row loses its text.
{
  const orphanFile = '/Users/x/.codex/sessions/2026/07/17/rollout-review-sub.jsonl';
  const seed = {
    uuid: 'of-user',
    textPreview: 'Review the diff on branch …',
    isSynthetic: true,
    isSidechain: true,
    parentSessionId: 'root-not-on-disk',
    sessionId: 'review-thread',
    timestamp: '2026-07-17T07:53:12.000Z',
    filePath: orphanFile,
  };
  const asst = {
    uuid: 'of-asst',
    isSidechain: true,
    parentSessionId: 'root-not-on-disk',
    sessionId: 'review-thread',
    timestamp: '2026-07-17T07:53:20.000Z',
    filePath: orphanFile,
  };
  const parentMap = { 'of-user': null, 'of-asst': 'of-user' };

  const stats = linkSidechainParents({
    assistantRecords: [asst],
    userRecords: [seed],
    parentMap,
  });
  assert.equal(stats.relinked, 0, 'nothing to anchor onto');
  assert.equal(stats.orphans, 1, 'seed reported as orphan');

  const index = buildTurnIndex([asst], [seed], parentMap);
  assert.equal(
    index.get('of-asst'),
    'of-user',
    'unanchored seed roots its own turn, so the row keeps its text',
  );

  // Same records, but now the spawner IS present: the seed goes back to being
  // synthetic and the turn folds — the synthetic bypass must not be sticky.
  const rootAsst = {
    uuid: 'of-root-asst',
    sessionId: 'root-not-on-disk',
    timestamp: '2026-07-17T07:53:00.000Z',
    filePath: '/Users/x/.codex/sessions/2026/07/17/rollout-root.jsonl',
  };
  const rootUser = {
    uuid: 'of-root-user',
    textPreview: 'kick off the review',
    isSynthetic: false,
    sessionId: 'root-not-on-disk',
    timestamp: '2026-07-17T07:52:50.000Z',
    filePath: '/Users/x/.codex/sessions/2026/07/17/rollout-root.jsonl',
  };
  const map2 = { 'of-root-user': null, 'of-root-asst': 'of-root-user', 'of-user': null, 'of-asst': 'of-user' };
  linkSidechainParents({
    assistantRecords: [rootAsst, asst],
    userRecords: [rootUser, seed],
    parentMap: map2,
  });
  const index2 = buildTurnIndex([rootAsst, asst], [rootUser, seed], map2);
  assert.equal(
    index2.get('of-asst'),
    'of-root-user',
    'once the spawner exists the same seed folds again (bypass is derived, not sticky)',
  );
  console.log('✓ orphan fallback: unanchored seed keeps its text; folds again once the spawner appears');
}

// ── filter boundary: linking is global, buildTurnIndex is filtered ────
// lib/serialize.ts and app/page.tsx call buildTurnIndex with the range/source
// FILTERED records but the UNFILTERED parentMap. A date range that cuts between
// a spawning turn and its sub-agent leaves the walk with no real user in scope,
// which used to strip the row's text entirely. The seed is the last-resort root.
{
  const rootSession = 'root-boundary';
  const dir = '/Users/x/.codex/sessions/2026/08/01';
  const uMain = {
    uuid: 'fb-u-main',
    textPreview: '已确认，就以 TD 为准',
    isSynthetic: false,
    sessionId: rootSession,
    timestamp: '2026-08-01T06:06:57.000Z',
    filePath: `${dir}/rollout-root.jsonl`,
  };
  const aMain = {
    uuid: 'fb-a-main',
    sessionId: rootSession,
    timestamp: '2026-08-01T06:07:05.000Z',
    filePath: `${dir}/rollout-root.jsonl`,
  };
  const guardUser = {
    uuid: 'fb-g-user',
    textPreview: 'The following is the Codex agent history …',
    isSynthetic: true,
    isSidechain: true,
    parentSessionId: rootSession,
    sessionId: 'guardian',
    timestamp: '2026-08-01T06:08:15.000Z',
    filePath: `${dir}/rollout-guardian.jsonl`,
  };
  const guardAsst = {
    uuid: 'fb-g-asst',
    isSidechain: true,
    parentSessionId: rootSession,
    sessionId: 'guardian',
    timestamp: '2026-08-01T06:08:20.000Z',
    filePath: `${dir}/rollout-guardian.jsonl`,
  };

  const all = { assistants: [aMain, guardAsst], users: [uMain, guardUser] };
  const parentMap = { 'fb-u-main': null, 'fb-a-main': 'fb-u-main', 'fb-g-user': null, 'fb-g-asst': 'fb-g-user' };
  linkSidechainParents({ assistantRecords: all.assistants, userRecords: all.users, parentMap });
  assert.equal(parentMap['fb-g-user'], 'fb-a-main', 'guardian linked while unfiltered');

  // Unfiltered: folds into the real conversation turn.
  const whole = buildTurnIndex(all.assistants, all.users, parentMap);
  assert.equal(whole.get('fb-g-asst'), 'fb-u-main', 'in range, guardian folds into the spawning turn');

  // Filtered so the spawning USER falls outside the window (its assistant does
  // not) — the previous behaviour merged the guardian into a text-less row.
  const cutUser = buildTurnIndex(all.assistants, [guardUser], parentMap);
  assert.equal(
    cutUser.get('fb-g-asst'),
    'fb-g-user',
    'spawning user out of range -> guardian roots at its own seed, keeping text',
  );

  // Filtered so the whole spawning thread is outside the window.
  const cutAll = buildTurnIndex([guardAsst], [guardUser], parentMap);
  assert.equal(
    cutAll.get('fb-g-asst'),
    'fb-g-user',
    'spawning thread fully out of range -> still roots at the seed, not a per-call orphan',
  );

  // The fallback must not drag the spawning thread's own records into the
  // sub-agent's turn via the memo — aMain still roots at its own user.
  const both = buildTurnIndex([guardAsst, aMain], all.users, parentMap);
  assert.equal(both.get('fb-a-main'), 'fb-u-main', 'parent record keeps its own root after a fallback walk');
  assert.equal(both.get('fb-g-asst'), 'fb-u-main', 'and the guardian still folds when both are in range');

  console.log('✓ filter boundary: seed is the last-resort root; memo never steals the parent thread');
}

console.log('\nAll sidechain-linking assertions passed.');
