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

console.log('\nAll sidechain-linking assertions passed.');
