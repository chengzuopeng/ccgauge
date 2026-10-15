#!/usr/bin/env node --experimental-strip-types --no-warnings

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { parseCodexJsonlFile } = await import(join(root, 'lib/providers/codex/parse-codex-jsonl.ts'));
const { linkSidechainParents } = await import(join(root, 'lib/data-loader/link-sidechain.ts'));
const { buildTurnIndex } = await import(join(root, 'lib/turns.ts'));

const dir = mkdtempSync(join(tmpdir(), 'ccgauge-guardian-'));

const PARENT = '01a12fe4-f02f-7390-b27e-2f9629ba0606';
const GUARD = '01a13028-8d7f-7922-b890-6d60e301d61c';

const ev = (timestamp, type, payload) => ({ timestamp, type, payload });

function jsonl(lines) {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function writeParent(file) {
  writeFileSync(
    file,
    jsonl([
      ev('2026-10-12T10:00:00.000Z', 'session_meta', { id: PARENT, cwd: '/w', cli_version: '0.162.0', thread_source: 'user', source: 'vscode' }),
      ev('2026-10-12T10:00:01.000Z', 'event_msg', { type: 'task_started', turn_id: 't-1' }),
      ev('2026-10-12T10:00:02.000Z', 'event_msg', { type: 'user_message', message: 'fix the build' }),
      ev('2026-10-12T10:00:03.000Z', 'turn_context', { turn_id: 't-1', cwd: '/w', model: 'gpt-6.1-sol' }),
      ev('2026-10-12T10:00:04.000Z', 'response_item', { type: 'function_call', name: 'exec_command', arguments: '{}' }),
      ev('2026-10-12T10:00:06.000Z', 'event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 300, reasoning_output_tokens: 0 },
          last_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 300, reasoning_output_tokens: 0 },
        },
      }),
    ]),
  );
}

function writeReview(file, meta) {
  writeFileSync(
    file,
    jsonl([
      ev('2026-10-12T10:00:07.000Z', 'session_meta', { id: GUARD, cwd: '/w', cli_version: '0.162.0', ...meta }),
      ev('2026-10-12T10:00:07.100Z', 'turn_context', { turn_id: 'g-1', cwd: '/w', model: 'codex-auto-review' }),
      ev('2026-10-12T10:00:07.200Z', 'event_msg', { type: 'task_started', turn_id: 'g-1' }),
      ev('2026-10-12T10:00:07.300Z', 'response_item', {
        type: 'message',
        id: 'msg-p',
        role: 'user',
        content: [{ type: 'input_text', text: 'Review this command for risk' }],
      }),
      ev('2026-10-12T10:00:08.000Z', 'response_item', { type: 'reasoning', summary: [] }),
      ev('2026-10-12T10:00:08.500Z', 'response_item', {
        type: 'message',
        id: 'msg-a',
        role: 'assistant',
        content: [{ type: 'output_text', text: '{"risk":"low"}' }],
      }),
      ev('2026-10-12T10:00:09.000Z', 'event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 80, reasoning_output_tokens: 0 },
          last_token_usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 80, reasoning_output_tokens: 0 },
        },
      }),
    ]),
  );
}

async function link(name, meta) {
  const parentFile = join(dir, `${name}-parent.jsonl`);
  const reviewFile = join(dir, `${name}-review.jsonl`);
  writeParent(parentFile);
  writeReview(reviewFile, meta);
  const parent = await parseCodexJsonlFile(parentFile);
  const review = await parseCodexJsonlFile(reviewFile);
  const assistants = [...parent.assistant, ...review.assistant].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  const users = [...parent.user, ...review.user];
  const parentMap = Object.fromEntries([...parent.parentLinks, ...review.parentLinks]);
  const stats = linkSidechainParents({ assistantRecords: assistants, userRecords: users, parentMap, spawnedSessions: [] });
  const index = buildTurnIndex(assistants, users, parentMap);
  return { parent, review, stats, index };
}

const subagentMeta = (threadSource, source) => ({
  ...(threadSource ? { thread_source: threadSource } : {}),
  session_id: PARENT,
  parent_thread_id: PARENT,
  forked_from_id: null,
  source,
});

for (const [name, meta] of [
  ['guardian_review', subagentMeta('guardian_review', { subagent: { other: 'guardian' } })],
  ['subagent', subagentMeta('subagent', { subagent: { thread_spawn: {} } })],
  ['source-only', subagentMeta(undefined, { subagent: { other: 'guardian' } })],
]) {
  const { parent, review, stats, index } = await link(name, meta);
  const [call] = review.assistant;
  assert.equal(review.user.length, 0, `${name}: the review carries no user record`);
  assert.equal(call.isSidechain, true, `${name}: marked as a sub-agent`);
  assert.equal(call.parentSessionId, PARENT, `${name}: parent thread recorded`);
  assert.equal(stats.relinked, 1, `${name}: the review is anchored to the parent`);
  assert.equal(index.get(call.uuid), parent.user[0].uuid, `${name}: folds into the turn that triggered it`);
  console.log(`✓ ${name}: review folds into the turn that triggered it`);
}

{
  const { review, stats, index } = await link('exec', { thread_source: 'user', source: 'exec' });
  const [call] = review.assistant;
  assert.equal(call.isSidechain, undefined, 'a plain exec session is not a sub-agent');
  assert.equal(call.parentSessionId, undefined);
  assert.equal(stats.relinked, 0);
  assert.equal(index.get(call.uuid), call.uuid, 'a plain exec session keeps its own turn');
  console.log('✓ plain exec session stays its own turn');
}

rmSync(dir, { recursive: true, force: true });
