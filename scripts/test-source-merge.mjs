#!/usr/bin/env node --experimental-strip-types --no-warnings

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { combineTotals, combineTimeBuckets } = await import(join(root, 'lib/source-merge.ts'));

{
  const out = combineTotals([]);
  assert.equal(out.inputTokens, 0);
  assert.equal(out.requests, 0);
  assert.equal(out.cost, 0);
  console.log('✓ combineTotals: empty input → zero snapshot');
}

{
  const t = {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 200,
    cacheCreationTokens: 30,
    totalTokens: 380,
    cost: 1.23,
    saved: 0.5,
    requests: 5,
  };
  const out = combineTotals([t]);
  assert.equal(out, t, 'single-input shortcut should return the same object reference');
  console.log('✓ combineTotals: single input is returned as-is (no copy)');
}

{
  const claude = {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 200,
    cacheCreationTokens: 30,
    totalTokens: 380,
    cost: 1.5,
    saved: 0.4,
    requests: 5,
  };
  const codex = {
    inputTokens: 70,
    outputTokens: 80,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 150,
    cost: 0.9,
    saved: 0,
    requests: 3,
  };
  const out = combineTotals([claude, codex]);
  assert.equal(out.inputTokens, 170);
  assert.equal(out.outputTokens, 130);
  assert.equal(out.cacheReadTokens, 200);
  assert.equal(out.cacheCreationTokens, 30);
  assert.equal(out.totalTokens, 530);
  assert.equal(out.requests, 8);

  assert.equal(out.cost.toFixed(2), '2.40');
  assert.equal(out.saved.toFixed(2), '0.40');
  console.log('✓ combineTotals: two-input field-wise sum');
}

{
  const a = { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 10, cost: 0.1, saved: 0, requests: 1 };
  const b = { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 20, cost: 0.2, saved: 0, requests: 2 };
  const c = { inputTokens: 30, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 30, cost: 0.3, saved: 0, requests: 3 };
  const out = combineTotals([a, b, c]);
  assert.equal(out.inputTokens, 60);
  assert.equal(out.requests, 6);
  assert.equal(out.cost.toFixed(2), '0.60');
  console.log('✓ combineTotals: three-input sum (forward-compatible)');
}

{
  const out = combineTimeBuckets([]);
  assert.deepEqual(out, []);
  console.log('✓ combineTimeBuckets: empty input → empty output');
}

{
  const one = [
    bucket('2026-05-10', 'May 10', { input: 100, cost: 1.0, requests: 1, models: { 'claude-opus-4-7': { tokens: 100, cost: 1.0, requests: 1 } } }),
  ];
  const out = combineTimeBuckets([one]);
  assert.equal(out, one, 'single-series shortcut should return the same reference');
  console.log('✓ combineTimeBuckets: single series is returned as-is');
}

{
  const claudeSeries = [
    bucket('2026-05-10', 'May 10', { input: 100, output: 50, cacheRead: 200, cacheCreation: 30, total: 380, cost: 1.5, saved: 0.4, requests: 5, models: { 'claude-opus-4-7': { tokens: 380, cost: 1.5, requests: 5 } } }),
    bucket('2026-05-11', 'May 11', { input: 50, total: 50, cost: 0.5, requests: 2, models: { 'claude-sonnet-4-7': { tokens: 50, cost: 0.5, requests: 2 } } }),
  ];
  const codexSeries = [
    bucket('2026-05-10', 'May 10', { input: 70, output: 80, total: 150, cost: 0.9, requests: 3, models: { 'gpt-5.2-codex': { tokens: 150, cost: 0.9, requests: 3 } } }),
    bucket('2026-05-12', 'May 12', { input: 20, total: 20, cost: 0.2, requests: 1, models: { 'gpt-5': { tokens: 20, cost: 0.2, requests: 1 } } }),
  ];
  const merged = combineTimeBuckets([claudeSeries, codexSeries]);

  assert.deepEqual(
    merged.map((b) => b.key),
    ['2026-05-10', '2026-05-11', '2026-05-12'],
    'merged series is sorted ascending by key',
  );

  const may10 = merged.find((b) => b.key === '2026-05-10');
  assert.equal(may10.inputTokens, 170);
  assert.equal(may10.outputTokens, 130);
  assert.equal(may10.totalTokens, 530);
  assert.equal(may10.requests, 8);
  assert.equal(may10.cost.toFixed(2), '2.40');
  assert.equal(Object.keys(may10.models).length, 2, 'May 10 has both Claude + Codex models');
  assert.equal(may10.models['claude-opus-4-7'].tokens, 380);
  assert.equal(may10.models['gpt-5.2-codex'].tokens, 150);

  const may11 = merged.find((b) => b.key === '2026-05-11');
  assert.equal(may11.totalTokens, 50);
  assert.equal(Object.keys(may11.models).length, 1);

  const may12 = merged.find((b) => b.key === '2026-05-12');
  assert.equal(may12.totalTokens, 20);
  assert.equal(Object.keys(may12.models).length, 1);

  console.log('✓ combineTimeBuckets: same-day sum + models union, disjoint days pass through');
}

{
  const input = [
    bucket('2026-05-10', 'May 10', { input: 100, total: 100, cost: 1.0, requests: 1, models: { 'm': { tokens: 100, cost: 1.0, requests: 1 } } }),
  ];
  const inputBefore = JSON.parse(JSON.stringify(input));
  const merged = combineTimeBuckets([input, [bucket('2026-05-10', 'May 10', { input: 20, total: 20, cost: 0.5, requests: 1, models: { 'n': { tokens: 20, cost: 0.5, requests: 1 } } })]]);

  merged[0].inputTokens = 99999;
  merged[0].models['m'].tokens = 99999;
  assert.deepEqual(input, inputBefore, 'merging must not mutate the caller\'s input buckets');
  console.log('✓ combineTimeBuckets: merging does not mutate the caller\'s input arrays');
}

{
  const s1 = [bucket('d', 'd', { input: 100, total: 100, cost: 1, requests: 1, models: { 'shared': { tokens: 100, cost: 1, requests: 1 } } })];
  const s2 = [bucket('d', 'd', { input: 50, total: 50, cost: 0.5, requests: 1, models: { 'shared': { tokens: 50, cost: 0.5, requests: 1 } } })];
  const merged = combineTimeBuckets([s1, s2]);
  assert.equal(merged[0].models['shared'].tokens, 150);
  assert.equal(merged[0].models['shared'].requests, 2);
  console.log('✓ combineTimeBuckets: colliding model names sum (defensive)');
}

console.log('\nAll source-merge assertions passed.');

function bucket(key, label, partial = {}) {
  return {
    key,
    label,
    inputTokens: partial.input ?? 0,
    outputTokens: partial.output ?? 0,
    cacheReadTokens: partial.cacheRead ?? 0,
    cacheCreationTokens: partial.cacheCreation ?? 0,
    totalTokens: partial.total ?? 0,
    cost: partial.cost ?? 0,
    saved: partial.saved ?? 0,
    requests: partial.requests ?? 0,
    models: partial.models ?? {},
  };
}
