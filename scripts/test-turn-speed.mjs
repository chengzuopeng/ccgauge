#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-turn-speed-'));

const iso = (hms) => `2026-10-01T${hms}.000Z`;

const usage = (output) => ({
  input_tokens: 1,
  output_tokens: output,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_5m: 0,
  cache_creation_1h: 0,
});

function assistant(uuid, parentUuid, timestamp, endTimestamp, output, extra = {}) {
  return {
    type: 'assistant',
    source: 'claude',
    uuid,
    parentUuid,
    timestamp: iso(timestamp),
    endTimestamp: iso(endTimestamp),
    sessionId: 's1',
    requestId: `r-${uuid}`,
    cwd: '/tmp/proj',
    model: 'claude-opus-4-8',
    messageId: `m-${uuid}`,
    usage: usage(output),
    toolNames: [],
    hasThinking: false,
    textPreview: '',
    filePath: '/tmp/proj/s1.jsonl',
    ...extra,
  };
}

function user(uuid, parentUuid, timestamp, textPreview, source = 'claude') {
  return {
    type: 'user',
    source,
    uuid,
    parentUuid,
    timestamp: iso(timestamp),
    sessionId: 's1',
    cwd: '/tmp/proj',
    textPreview,
    filePath: '/tmp/proj/s1.jsonl',
  };
}

try {
  const entry = join(dir, 'entry.ts');
  writeFileSync(entry, "export { recordsToTurnRows } from '@/lib/serialize';\n");
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

  const records = [
    assistant('c1', 'u1', '10:00:05', '10:00:10', 500),
    assistant('c2', 'u2', '10:00:22', '10:00:30', 400),
    assistant('c3', 'u3', '10:00:41', '10:00:45', 20),
    assistant('c4', 'c3', '10:00:50', '10:00:55', 300),
    assistant('c5', 'u8', '11:00:02', '11:00:03', 10),
    assistant('x1', 'u9', '12:00:10', '12:00:07', 1000, {
      source: 'codex',
      model: 'gpt-5.5',
      startTimestamp: iso('12:00:02'),
      callOutputTokens: 100,
    }),
  ];
  const users = [
    user('u1', null, '10:00:00', 'hello'),
    user('u2', 'c1', '10:00:20', ''),
    user('u3', 'c2', '10:00:40', ''),
    user('u8', null, '11:00:00', 'tiny'),
    user('u9', null, '12:00:00', 'codex', 'codex'),
  ];
  const parentMap = {
    u1: null,
    c1: 'u1',
    u2: 'c1',
    c2: 'u2',
    u3: 'c2',
    c3: 'u3',
    c4: 'c3',
    u8: null,
    c5: 'u8',
    u9: null,
    x1: 'u9',
  };

  const turns = m.recordsToTurnRows(records, users, parentMap);
  const turnOf = (text) => turns.find((t) => t.userText === text);
  const childOf = (turn, uuid) => turn.children.find((c) => c.uuid === uuid);

  {
    const turn = turnOf('hello');
    assert.equal(turn.callCount, 4);
    const [c1, c2, c3, c4] = ['c1', 'c2', 'c3', 'c4'].map((id) => childOf(turn, id));
    assert.deepEqual([c1.generationMs, c1.generationOutputTokens, c1.outputSpeed], [10_000, 500, 50]);
    assert.deepEqual([c2.generationMs, c2.generationOutputTokens, c2.outputSpeed], [10_000, 400, 40]);
    assert.deepEqual([c3.generationMs, c3.generationOutputTokens, c3.outputSpeed], [5_000, 20, null]);
    assert.deepEqual([c4.generationMs, c4.generationOutputTokens, c4.outputSpeed], [null, null, null]);
    assert.deepEqual([turn.generationMs, turn.generationOutputTokens, turn.outputSpeed], [20_000, 900, 45]);
    console.log('✓ turn speed: sums only the timed calls; a chained request stays untimed');
  }

  {
    const turn = turnOf('tiny');
    assert.equal(childOf(turn, 'c5').generationMs, 3_000);
    assert.equal(childOf(turn, 'c5').outputSpeed, null);
    assert.deepEqual([turn.generationMs, turn.generationOutputTokens, turn.outputSpeed], [null, null, null]);
    console.log('✓ turn speed: a turn with no timed call has no speed');
  }

  {
    const turn = turnOf('codex');
    const x1 = childOf(turn, 'x1');
    assert.equal(x1.outputTokens, 1000);
    assert.deepEqual([x1.generationMs, x1.generationOutputTokens, x1.outputSpeed], [5_000, 100, 20]);
    assert.equal(turn.outputSpeed, 20);
    console.log('✓ turn speed: a codex call is timed by its own call output, not the billed total');
  }

  {
    const loose = m.recordsToTurnRows(records, users, parentMap, new Set());
    const c4 = loose.find((t) => t.userText === 'hello').children.find((c) => c.uuid === 'c4');
    assert.equal(c4.generationMs, 15_000);
    console.log('✓ turn speed: the assistant set decides where the start walk stops');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
