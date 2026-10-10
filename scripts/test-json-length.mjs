#!/usr/bin/env node --experimental-strip-types --no-warnings
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { jsonLength } = await import(join(root, 'lib/data-loader/parse-jsonl.ts'));

const base64 = Buffer.alloc(300_000, 7).toString('base64');
const samples = [
  null,
  true,
  false,
  0,
  -0,
  42,
  -3.5,
  1e21,
  1.5e-7,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '',
  'plain',
  'quote " backslash \\ slash /',
  'newline\n tab\t nul\u0000 bell\u0007 del\u007f',
  '中文 émoji 😀 pair',
  'lone high \ud83d here',
  'lone low \ude00 here',
  base64,
  [],
  {},
  [1, 'two', null, [3, [4]], { five: 5 }],
  [undefined, () => 1, Symbol('s'), 'kept'],
  { a: 1, b: undefined, c: () => 1, d: Symbol('s'), e: 'kept' },
  { 'key "quoted"': 'v', 'k\n': 'w', 'ключ': 'x' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
  { type: 'tool_reference', tool_name: 'Bash', nested: { deep: [{ x: [true, false, null] }] } },
  { when: new Date(Date.UTC(2026, 8, 1)) },
];

for (const v of samples) {
  const expected = JSON.stringify(v)?.length ?? 0;
  assert.equal(jsonLength(v), expected, `jsonLength(${String(JSON.stringify(v)).slice(0, 60)})`);
}
assert.equal(jsonLength(undefined), 0, 'undefined measures as nothing, like the old stringify fallback');
console.log('✓ jsonLength matches JSON.stringify(...).length without building the string');
console.log('\nAll json-length assertions passed.');
