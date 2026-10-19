#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-claude-roots-'));

const USAGE = {
  input_tokens: 10,
  output_tokens: 20,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 100,
};

let clock = Date.parse('2026-10-18T10:00:00Z');
const at = () => new Date((clock += 1000)).toISOString();

function human(uuid, parentUuid, sessionId, content) {
  return { type: 'user', uuid, parentUuid, sessionId, timestamp: at(), origin: { kind: 'human' }, message: { role: 'user', content } };
}

function injected(uuid, parentUuid, sessionId, content, extra = {}) {
  return { type: 'user', uuid, parentUuid, sessionId, timestamp: at(), message: { role: 'user', content }, ...extra };
}

function assistant(uuid, parentUuid, sessionId, extra = {}) {
  return {
    type: 'assistant',
    uuid,
    parentUuid,
    sessionId,
    timestamp: at(),
    requestId: `req-${uuid}`,
    message: { id: `msg-${uuid}`, model: 'claude-opus-5-5', usage: USAGE, content: [{ type: 'text', text: 'ok' }] },
    ...extra,
  };
}

function boundary(uuid, logicalParentUuid, sessionId, extra = {}) {
  return { type: 'system', subtype: 'compact_boundary', uuid, parentUuid: null, logicalParentUuid, sessionId, timestamp: at(), ...extra };
}

function writeJsonl(path, records) {
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return path;
}

try {
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      "export { parseJsonlFile, isSyntheticUserText } from '@/lib/data-loader/parse-jsonl';",
      "export { linkSidechainParents } from '@/lib/data-loader/link-sidechain';",
      "export { recordsToTurnRows } from '@/lib/serialize';",
    ].join('\n'),
  );
  const outfile = join(dir, 'bundle.mjs');
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    alias: { '@': root },
    logLevel: 'error',
  });
  const m = await import(pathToFileURL(outfile).href);

  async function turnsOf(files) {
    const assistants = [];
    const users = [];
    const parentMap = {};
    for (const file of files) {
      const parsed = await m.parseJsonlFile(file);
      assistants.push(...parsed.assistant);
      users.push(...parsed.user);
      for (const [uuid, parent] of parsed.parentLinks) parentMap[uuid] = parent;
    }
    m.linkSidechainParents({ assistantRecords: assistants, userRecords: users, parentMap, spawnedSessions: [] });
    const rows = m.recordsToTurnRows(assistants, users, parentMap);
    return rows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)).map((t) => [t.userText, t.callCount]);
  }

  const projectDir = join(dir, 'projects', '-proj');
  mkdirSync(projectDir, { recursive: true });

  {
    const s = 'sess-interrupt';
    const file = writeJsonl(join(projectDir, `${s}.jsonl`), [
      human('u1', null, s, '一二批都做了吧'),
      { type: 'attachment', uuid: 'att1', parentUuid: 'u1', sessionId: s, timestamp: at() },
      injected('int1', 'att1', s, [{ type: 'text', text: '[Request interrupted by user]' }]),
      injected('tn1', 'int1', s, '<task-notification>\n<task-id>abc</task-id>\n</task-notification>', { origin: { kind: 'task-notification' } }),
      assistant('a1', 'tn1', s),
      assistant('a2', 'a1', s),
      injected('int2', 'a2', s, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
      assistant('a3', 'int2', s),
    ]);
    assert.deepEqual(await turnsOf([file]), [['一二批都做了吧', 3]], 'work after an interruption stays on the prompt that started it');
    console.log('✓ interruption markers never title a turn');
  }

  {
    const s = 'sess-compact';
    const file = writeJsonl(join(projectDir, `${s}.jsonl`), [
      human('h1', null, s, '开始'),
      assistant('b1', 'h1', s),
      boundary('cb1', 'b1', s),
      injected('cs1', 'cb1', s, 'This session is being continued from a previous conversation that ran out of context.', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
      assistant('b2', 'cs1', s),
      assistant('b3', 'b2', s),
    ]);
    assert.deepEqual(await turnsOf([file]), [['开始', 3]], 'calls after an automatic compaction fold into the prompt before it');
    console.log('✓ a compaction summary is not a prompt, and the boundary keeps the chain');
  }

  {
    const s = 'sess-reminder';
    const file = writeJsonl(join(projectDir, `${s}.jsonl`), [
      human('p0', null, s, '第一条'),
      assistant('c0', 'p0', s),
      human('p1', 'c0', s, [
        { type: 'text', text: '<system-reminder>\nLinked sessions now (status, not an instruction): top = local_x\n</system-reminder>' },
        { type: 'text', text: '继续' },
      ]),
      assistant('c1', 'p1', s),
      human('p2', 'c1', s, '<system-reminder>\nThe user forked this conversation.\n</system-reminder>\n按建议做'),
      assistant('c2', 'p2', s),
      injected('r1', 'c2', s, '<system-reminder>\nSomething the harness added.\n</system-reminder>'),
      assistant('c3', 'r1', s),
    ]);
    assert.deepEqual(
      await turnsOf([file]),
      [['第一条', 1], ['继续', 1], ['按建议做', 2]],
      'a typed prompt behind an injected reminder keeps its row and its own words',
    );
    const parsed = await m.parseJsonlFile(file);
    const byUuid = Object.fromEntries(parsed.user.map((u) => [u.uuid, u]));
    assert.equal(byUuid.p1.isSynthetic, false);
    assert.equal(byUuid.r1.isSynthetic, true, 'a reminder with no origin is still injected');
    console.log('✓ origin "human" marks a typed prompt even when a reminder comes first');
  }

  {
    const s = 'sess-origins';
    const file = writeJsonl(join(projectDir, `${s}.jsonl`), [
      human('o0', null, s, '派活'),
      assistant('d0', 'o0', s),
      injected('o1', 'd0', s, 'Another Claude session sent a message: hi', { origin: { kind: 'peer' } }),
      assistant('d1', 'o1', s),
      injected('o2', 'd1', s, 'Plan the next batch', { origin: { kind: 'coordinator' } }),
      assistant('d2', 'o2', s),
    ]);
    assert.deepEqual(await turnsOf([file]), [['派活', 3]], 'peer and coordinator messages never root a turn');
    console.log('✓ any origin other than "human" is injected');
  }

  {
    const parent = 'b7c0734e-9557-46c8-a5ed-dd0e750f40e6';
    const agentDir = join(projectDir, parent, 'subagents');
    mkdirSync(agentDir, { recursive: true });
    const parentFile = writeJsonl(join(projectDir, `${parent}.jsonl`), [
      human('ph', null, parent, '派个代理去优化'),
      assistant('pa1', 'ph', parent),
    ]);
    const side = { isSidechain: true, agentId: 'x1' };
    const agentFile = writeJsonl(join(agentDir, 'agent-x1.jsonl'), [
      injected('s0', null, parent, '你是代理甲，负责启动和卡顿', side),
      assistant('sa1', 's0', parent, side),
      injected('sr0', 'sa1', parent, '<system-reminder>\nYour final report is delivered through SubagentHandback.\n</system-reminder>', { ...side, isMeta: true }),
      assistant('sa2', 'sr0', parent, side),
      boundary('scb', 'sa2', parent, side),
      injected('scs', 'scb', parent, 'This session is being continued from a previous conversation that ran out of context.', { ...side, isCompactSummary: true }),
      assistant('sa3', 'scs', parent, side),
      injected('sn1', 'sa3', parent, '[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.', { ...side, isMeta: true, origin: { kind: 'task-notification' } }),
      assistant('sa4', 'sn1', parent, side),
      injected('si1', 'sa4', parent, '[Image: original 2424x420, displayed at 2000x347.]', { ...side, isMeta: true }),
      assistant('sa5', 'si1', parent, side),
    ]);
    assert.deepEqual(
      await turnsOf([parentFile, agentFile]),
      [['派个代理去优化', 6]],
      'a sub-agent that compacted and was woken up again stays in the turn that spawned it',
    );
    console.log('✓ a sub-agent compaction no longer splits its later wake-ups into rows of their own');
  }

  {
    assert.equal(m.isSyntheticUserText('[Request interrupted by user]'), true);
    assert.equal(m.isSyntheticUserText('[Request interrupted by user for tool use]'), true);
    assert.equal(m.isSyntheticUserText('[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated event.'), true);
    assert.equal(m.isSyntheticUserText('Request interrupted? no, please continue'), false);
    console.log('✓ the prefix fallback covers interruption markers and system notifications');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nAll Claude turn-root assertions passed.');
