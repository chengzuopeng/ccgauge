#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { forEachLine } = await import(join(root, 'lib/data-loader/read-lines.js'));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-read-lines-'));

async function lines(content, stopAfter) {
  const file = join(dir, `f-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(file, content);
  const out = [];
  await forEachLine(file, (buf) => {
    out.push(buf.toString('utf8'));
    if (stopAfter !== undefined && out.length >= stopAfter) return false;
  });
  return out;
}

try {
  assert.deepEqual(await lines('a\nb\nc\n'), ['a', 'b', 'c'], 'newline-terminated lines');
  assert.deepEqual(await lines('a\nb'), ['a', 'b'], 'a final line without a newline is still read');
  assert.deepEqual(await lines('a\r\nb\r\n'), ['a', 'b'], 'CRLF endings are stripped');
  assert.deepEqual(await lines('a\n\nb\n'), ['a', '', 'b'], 'empty lines are passed through');
  assert.deepEqual(await lines(''), [], 'an empty file yields nothing');

  const wide = '中'.repeat(400_000);
  const big = await lines(`${wide}\nx\n${wide}é\n`);
  assert.equal(big.length, 3, 'lines longer than one read chunk are joined');
  assert.equal(big[0], wide, 'a multi-byte character split across chunks decodes intact');
  assert.equal(big[2], `${wide}é`);

  assert.deepEqual(await lines('a\nb\nc\n', 2), ['a', 'b'], 'returning false stops reading');
  console.log('✓ forEachLine splits, joins and stops like readline did');
  console.log('\nAll read-lines assertions passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
