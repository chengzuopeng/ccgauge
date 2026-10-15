#!/usr/bin/env node --experimental-strip-types --no-warnings

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { dedupAssistantRecords } = await import(join(root, 'lib/dedup.ts'));
const {
  MIN_TIMED_OUTPUT_TOKENS,
  generationWindowMs,
  generationStartOf,
  summarizeTimedCalls,
  tokensPerSecond,
} = await import(join(root, 'lib/output-speed.ts'));
const { parseJsonlFile } = await import(join(root, 'lib/data-loader/parse-jsonl.ts'));
const { parseCodexJsonlFile } = await import(join(root, 'lib/providers/codex/parse-codex-jsonl.ts'));

const dir = mkdtempSync(join(tmpdir(), 'ccgauge-speed-'));

function jsonl(lines) {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

{
  assert.equal(generationWindowMs('2026-10-01T10:00:00.000Z', '2026-10-01T10:00:05.000Z'), 5000);
  assert.equal(generationWindowMs(undefined, '2026-10-01T10:00:05.000Z'), null);
  assert.equal(generationWindowMs('2026-10-01T10:00:05.000Z', '2026-10-01T10:00:05.000Z'), null);
  assert.equal(generationWindowMs('2026-10-01T10:00:06.000Z', '2026-10-01T10:00:05.000Z'), null);
  assert.equal(tokensPerSecond(MIN_TIMED_OUTPUT_TOKENS - 1, 1000), null);
  assert.equal(tokensPerSecond(MIN_TIMED_OUTPUT_TOKENS, 1000), 50);
  assert.equal(tokensPerSecond(100, null), null);
  console.log('✓ window and rate helpers: thresholds and invalid windows');
}

{
  const call = (generationMs, generationOutputTokens, outputSpeed) => ({ generationMs, generationOutputTokens, outputSpeed });
  const mixed = summarizeTimedCalls([call(10_000, 500, 50), call(10_000, 400, 40), call(5_000, 20, null), call(null, null, null)]);
  assert.deepEqual(mixed, { generationMs: 20_000, generationOutputTokens: 900, outputSpeed: 45 });
  const empty = { generationMs: null, generationOutputTokens: null, outputSpeed: null };
  assert.deepEqual(summarizeTimedCalls([call(5_000, 20, null), call(null, null, null)]), empty);
  assert.deepEqual(summarizeTimedCalls([]), empty);
  console.log('✓ turn speed summary: only timed calls count, empty and untimed turns stay null');
}

{
  const base = {
    type: 'assistant',
    source: 'claude',
    uuid: 'x1',
    parentUuid: null,
    timestamp: '2026-10-01T10:00:00.000Z',
    endTimestamp: '2026-10-01T10:00:00.000Z',
    sessionId: 's',
    requestId: 'r',
    cwd: '/w',
    model: 'claude-opus-5',
    messageId: 'm',
    usage: {
      input_tokens: 1,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
    },
    toolNames: [],
    toolUses: [{ id: 't1', name: 'Read' }],
    hasThinking: false,
    textPreview: '',
    filePath: 'f',
  };
  const later = { ...base, uuid: 'x2', timestamp: '2026-10-01T10:00:05.000Z', endTimestamp: '2026-10-01T10:00:05.000Z', toolUses: [{ id: 't2', name: 'Bash' }] };
  const merged = dedupAssistantRecords([base, later]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].uuid, 'x1');
  assert.equal(merged[0].endTimestamp, '2026-10-01T10:00:05.000Z');
  assert.deepEqual(merged[0].toolUses.map((t) => t.id), ['t1', 't2']);

  const legacy = dedupAssistantRecords([{ ...base, endTimestamp: undefined }, later]);
  assert.equal(legacy[0].endTimestamp, undefined);
  console.log('✓ dedup keeps the latest chunk end and unions tool uses');
}

{
  const claudeFile = join(dir, 'claude.jsonl');
  const user = (uuid, parentUuid, timestamp, content) => ({
    type: 'user',
    uuid,
    parentUuid,
    timestamp,
    sessionId: 's1',
    cwd: '/w',
    message: { role: 'user', content },
  });
  const asst = (uuid, parentUuid, timestamp, requestId, messageId, content, output) => ({
    type: 'assistant',
    uuid,
    parentUuid,
    timestamp,
    sessionId: 's1',
    requestId,
    cwd: '/w',
    message: {
      id: messageId,
      model: 'claude-opus-5',
      role: 'assistant',
      content,
      usage: { input_tokens: 5, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
  writeFileSync(
    claudeFile,
    jsonl([
      user('u1', null, '2026-10-01T10:00:00.000Z', 'hello'),
      asst('a1', 'u1', '2026-10-01T10:00:02.000Z', 'req1', 'm1', [{ type: 'thinking', thinking: '...' }], 100),
      asst('a2', 'a1', '2026-10-01T10:00:06.000Z', 'req1', 'm1', [{ type: 'text', text: 'ok' }], 100),
      asst('a3', 'a2', '2026-10-01T10:00:07.000Z', 'req1', 'm1', [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }], 100),
      user('t1', 'a3', '2026-10-01T10:00:09.000Z', [{ type: 'tool_result', tool_use_id: 'tu1', content: 'done' }]),
      { type: 'attachment', uuid: 'at1', parentUuid: 't1', timestamp: '2026-10-01T10:00:10.000Z', sessionId: 's1' },
      asst('a4', 'at1', '2026-10-01T10:00:20.000Z', 'req2', 'm2', [{ type: 'text', text: 'final' }], 300),
      asst('a5', 'nowhere', '2026-10-01T10:00:30.000Z', 'req3', 'm3', [{ type: 'text', text: 'orphan' }], 300),
      asst('a6', 'a3', '2026-10-01T10:00:40.000Z', 'req4', 'm4', [{ type: 'text', text: 'chained' }], 300),
    ]),
  );

  const parsed = await parseJsonlFile(claudeFile);
  const records = dedupAssistantRecords(parsed.assistant);
  const users = new Map(parsed.user.map((u) => [u.uuid, u]));
  const parentMap = Object.fromEntries(parsed.parentLinks);
  const byRequest = Object.fromEntries(records.map((r) => [r.requestId, r]));
  const assistantUuids = new Set(records.map((r) => r.uuid));

  const req1 = byRequest.req1;
  assert.equal(req1.timestamp, '2026-10-01T10:00:02.000Z');
  assert.equal(req1.endTimestamp, '2026-10-01T10:00:07.000Z');
  const req1Window = generationWindowMs(generationStartOf(req1, users, parentMap, assistantUuids), req1.endTimestamp);
  assert.equal(req1Window, 7000);
  assert.equal(Number(tokensPerSecond(req1.usage.output_tokens, req1Window).toFixed(2)), 14.29);

  const req2 = byRequest.req2;
  const req2Window = generationWindowMs(generationStartOf(req2, users, parentMap, assistantUuids), req2.endTimestamp);
  assert.equal(req2Window, 11000);
  assert.equal(Number(tokensPerSecond(req2.usage.output_tokens, req2Window).toFixed(2)), 27.27);

  const req3 = byRequest.req3;
  assert.equal(generationStartOf(req3, users, parentMap, assistantUuids), undefined);
  assert.equal(generationWindowMs(generationStartOf(req3, users, parentMap, assistantUuids), req3.endTimestamp), null);

  const req4 = byRequest.req4;
  assert.equal(generationStartOf(req4, users, parentMap, assistantUuids), undefined);
  assert.equal(generationWindowMs(generationStartOf(req4, users, parentMap, assistantUuids), req4.endTimestamp), null);
  console.log('✓ claude: chunks merge to one window, attachments are walked past, orphans and chained requests stay null');
}

{
  const codexFile = join(dir, 'rollout.jsonl');
  const ev = (timestamp, type, payload) => ({ timestamp, type, payload });
  writeFileSync(
    codexFile,
    jsonl([
      ev('2026-08-27T12:00:00.000Z', 'session_meta', { id: 'sess-1', cwd: '/w', cli_version: '0.147.0' }),
      ev('2026-08-27T12:00:01.000Z', 'event_msg', { type: 'task_started', turn_id: 't-1' }),
      ev('2026-08-27T12:00:02.000Z', 'event_msg', { type: 'user_message', message: 'do it' }),
      ev('2026-08-27T12:00:03.000Z', 'turn_context', { turn_id: 't-1', cwd: '/w', model: 'gpt-5.6-sol' }),
      ev('2026-08-27T12:00:05.000Z', 'response_item', { type: 'reasoning', summary: [] }),
      ev('2026-08-27T12:00:06.000Z', 'response_item', { type: 'function_call', name: 'exec_command', arguments: '{}' }),
      ev('2026-08-27T12:00:07.000Z', 'event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 },
        },
      }),
      ev('2026-08-27T12:00:09.000Z', 'response_item', { type: 'function_call_output', call_id: 'c1', output: 'ok' }),
      ev('2026-08-27T12:00:10.000Z', 'response_item', { type: 'reasoning', summary: [] }),
      ev('2026-08-27T12:00:12.000Z', 'response_item', {
        type: 'message',
        id: 'msg1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
      }),
      ev('2026-08-27T12:00:13.000Z', 'event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 150, cached_input_tokens: 50, output_tokens: 400, reasoning_output_tokens: 0 },
          last_token_usage: { input_tokens: 50, cached_input_tokens: 50, output_tokens: 200, reasoning_output_tokens: 0 },
        },
      }),
    ]),
  );

  const parsed = await parseCodexJsonlFile(codexFile);
  assert.equal(parsed.assistant.length, 2);
  const [first, second] = parsed.assistant;

  assert.equal(first.startTimestamp, '2026-08-27T12:00:02.000Z');
  assert.equal(first.endTimestamp, '2026-08-27T12:00:06.000Z');
  assert.equal(generationWindowMs(generationStartOf(first, new Map(), {}), first.endTimestamp), 4000);
  assert.equal(tokensPerSecond(first.usage.output_tokens, 4000), 50);

  assert.equal(second.startTimestamp, '2026-08-27T12:00:09.000Z');
  assert.equal(second.endTimestamp, '2026-08-27T12:00:12.000Z');
  assert.equal(generationWindowMs(generationStartOf(second, new Map(), {}), second.endTimestamp), 3000);
  assert.equal(Number(tokensPerSecond(second.usage.output_tokens, 3000).toFixed(2)), 66.67);
  console.log('✓ codex: each call starts when its last input arrived, including fast-path lines');
}

{
  const forkFile = join(dir, 'fork.jsonl');
  const ev = (timestamp, type, payload) => ({ timestamp, type, payload });
  writeFileSync(
    forkFile,
    jsonl([
      ev('2026-10-14T03:52:00.000Z', 'session_meta', { id: 'fork-1', thread_source: 'user', forked_from_id: 'parent-1', cwd: '/w' }),
      ev('2026-10-14T03:52:10.000Z', 'event_msg', { type: 'user_message', message: 'continue' }),
      ev('2026-10-14T03:52:15.000Z', 'response_item', { type: 'reasoning', summary: [] }),
      ev('2026-10-14T03:52:27.000Z', 'event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 80896824, cached_input_tokens: 74230648, output_tokens: 426343, reasoning_output_tokens: 0 },
          last_token_usage: { input_tokens: 188764, cached_input_tokens: 0, output_tokens: 358, reasoning_output_tokens: 0 },
        },
      }),
    ]),
  );
  const parsed = await parseCodexJsonlFile(forkFile);
  const [call] = parsed.assistant;
  assert.equal(call.callOutputTokens, 358);
  const windowMs = generationWindowMs(generationStartOf(call, new Map(), {}), call.endTimestamp);
  assert.equal(windowMs, 5000);
  assert.equal(Number(tokensPerSecond(call.callOutputTokens, windowMs).toFixed(2)), 71.6);
  console.log('✓ codex: a replayed fork call is timed by its own per-call output, not the cumulative total');
}

{
  const abortedFile = join(dir, 'aborted.jsonl');
  const ev = (timestamp, type, payload) => ({ timestamp, type, payload });
  writeFileSync(
    abortedFile,
    jsonl([
      ev('2026-10-20T10:00:00.000Z', 'session_meta', { id: 'abort-1', cwd: '/w' }),
      ev('2026-10-20T10:00:01.000Z', 'event_msg', { type: 'task_started', turn_id: 't-1' }),
      ev('2026-10-20T10:00:02.000Z', 'event_msg', { type: 'user_message', message: 'first' }),
      ev('2026-10-20T10:00:05.000Z', 'response_item', { type: 'reasoning', summary: [] }),
      ev('2026-10-20T10:01:00.000Z', 'event_msg', { type: 'task_started', turn_id: 't-2' }),
      ev('2026-10-20T10:01:01.000Z', 'event_msg', { type: 'user_message', message: 'second' }),
      ev('2026-10-20T10:01:04.000Z', 'response_item', { type: 'reasoning', summary: [] }),
      ev('2026-10-20T10:01:06.000Z', 'response_item', { type: 'function_call', name: 'exec_command', arguments: '{}' }),
      ev('2026-10-20T10:01:08.000Z', 'event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 },
        },
      }),
    ]),
  );
  const parsed = await parseCodexJsonlFile(abortedFile);
  assert.equal(parsed.assistant.length, 1);
  const [call] = parsed.assistant;
  assert.equal(call.startTimestamp, '2026-10-20T10:01:01.000Z');
  assert.equal(call.endTimestamp, '2026-10-20T10:01:06.000Z');
  console.log('✓ codex: a new task_started drops the timing of an interrupted response');
}

{
  const roleFile = join(dir, 'norole.jsonl');
  const ev = (timestamp, type, payload) => ({ timestamp, type, payload });
  writeFileSync(
    roleFile,
    jsonl([
      ev('2026-10-20T11:00:00.000Z', 'session_meta', { id: 'norole-1', cwd: '/w' }),
      ev('2026-10-20T11:00:01.000Z', 'event_msg', { type: 'task_started', turn_id: 't-1' }),
      ev('2026-10-20T11:00:02.000Z', 'event_msg', { type: 'user_message', message: 'go' }),
      ev('2026-10-20T11:00:05.000Z', 'response_item', {
        type: 'message',
        id: 'm-1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'first part' }],
      }),
      ev('2026-10-20T11:00:06.000Z', 'response_item', {
        type: 'message',
        content: [{ type: 'output_text', text: 'second part' }],
        role: 'assistant',
      }),
      ev('2026-10-20T11:00:07.000Z', 'event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 },
        },
      }),
    ]),
  );
  const parsed = await parseCodexJsonlFile(roleFile);
  assert.equal(parsed.assistant.length, 1);
  assert.equal(parsed.assistant[0].endTimestamp, '2026-10-20T11:00:06.000Z');
  console.log('✓ codex: an assistant message whose role the head cannot see still ends the window');
}

rmSync(dir, { recursive: true, force: true });
