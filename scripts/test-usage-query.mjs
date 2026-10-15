#!/usr/bin/env node --experimental-strip-types --no-warnings

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const { sortTurns, isSortKey } = await import(join(root, 'lib/usage-query.ts'));

const row = (turnId, timestamp, outputSpeed, durationMs = 0) => ({ turnId, timestamp, outputSpeed, durationMs });
const ids = (rows) => rows.map((r) => r.turnId);

{
  const rows = [
    row('a', '2026-10-01T10:00:00Z', 10),
    row('b', '2026-10-01T11:00:00Z', null),
    row('c', '2026-10-01T12:00:00Z', 30),
    row('d', '2026-10-01T13:00:00Z', 20),
    row('e', '2026-10-01T14:00:00Z', null),
  ];
  assert.deepEqual(ids(sortTurns(rows, 'outputSpeed', 'desc')), ['c', 'd', 'a', 'b', 'e']);
  assert.deepEqual(ids(sortTurns(rows, 'outputSpeed', 'asc')), ['a', 'd', 'c', 'b', 'e']);
  console.log('✓ sortTurns: rows without a speed sort last in both directions, in input order');

  assert.deepEqual(ids(sortTurns(rows, 'timestamp', 'desc')), ['e', 'd', 'c', 'b', 'a']);
  assert.deepEqual(ids(sortTurns(rows, 'timestamp', 'asc')), ['a', 'b', 'c', 'd', 'e']);
  console.log('✓ sortTurns: timestamp compares as text');

  assert.deepEqual(ids(rows), ['a', 'b', 'c', 'd', 'e']);
  console.log('✓ sortTurns: the input array is not reordered');
}

{
  const rows = [
    row('a', '2026-10-01T10:00:00Z', null, 5),
    row('b', '2026-10-01T11:00:00Z', null, 9),
    row('c', '2026-10-01T12:00:00Z', null, 5),
  ];
  assert.deepEqual(ids(sortTurns(rows, 'durationMs', 'desc')), ['b', 'a', 'c']);
  assert.deepEqual(ids(sortTurns(rows, 'durationMs', 'asc')), ['a', 'c', 'b']);
  console.log('✓ sortTurns: equal values keep their input order');
}

{
  assert.equal(isSortKey('outputSpeed'), true);
  assert.equal(isSortKey('nope'), false);
  console.log('✓ isSortKey: accepts outputSpeed, rejects unknown keys');
}
