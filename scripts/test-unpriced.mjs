#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-unpriced-'));

function assistant(uuid, model, extra = {}) {
  return {
    type: 'assistant',
    source: 'codex',
    uuid,
    parentUuid: 'u1',
    timestamp: `2026-09-01T10:00:0${uuid.slice(-1)}Z`,
    sessionId: 's1',
    requestId: `r-${uuid}`,
    cwd: '/tmp/proj',
    model,
    messageId: `m-${uuid}`,
    usage: {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
    },
    toolNames: [],
    hasThinking: false,
    textPreview: '',
    filePath: '/tmp/proj/s1.jsonl',
    ...extra,
  };
}

try {
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      "export { pricedCostOfRecord } from '@/lib/pricing/calculate';",
      "export { recordsToTurnRows } from '@/lib/serialize';",
      "export { aggregateTotals, aggregateByModel } from '@/lib/aggregator';",
      "export { recordsToTurnRowsCached } from '@/lib/data-loader/derived';",
      "export { BUILTIN_PRICING_OPENAI, FALLBACK_FAMILY_OPENAI } from '@/lib/providers/codex/pricing';",
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

  const exact = assistant('a1', 'gpt-5.5');
  const family = assistant('a2', 'gpt-9-future');
  const unknown = assistant('a3', 'totally-unknown-model');
  const inherited = assistant('a4', 'constructor');
  const records = [exact, family, unknown, inherited];
  const users = [
    {
      type: 'user',
      source: 'codex',
      uuid: 'u1',
      parentUuid: null,
      timestamp: '2026-09-01T10:00:00Z',
      sessionId: 's1',
      cwd: '/tmp/proj',
      textPreview: 'hello',
      filePath: '/tmp/proj/s1.jsonl',
    },
  ];
  const parentMap = { u1: null, a1: 'u1', a2: 'u1', a3: 'u1', a4: 'u1' };

  {
    const e = m.pricedCostOfRecord(exact);
    assert.equal(e.priced, true, 'an exact match is priced');
    assert.ok(e.cost.total > 0, 'and costs something');
    const f = m.pricedCostOfRecord(family);
    assert.equal(f.priced, true, 'a family fallback is priced, not unpriced');
    assert.ok(f.cost.total > 0, 'at its fallback rate');
    const u = m.pricedCostOfRecord(unknown);
    assert.equal(u.priced, false, 'no match at all is unpriced');
    assert.equal(u.cost.total, 0, 'and counted as $0');
    const i = m.pricedCostOfRecord(inherited);
    assert.equal(i.priced, false, 'an inherited object key is unpriced');
    assert.equal(i.cost.total, 0, 'and never NaN');
    console.log('✓ pricedCostOfRecord: exact and family fallback priced, no match unpriced at $0');
  }

  {
    const turns = m.recordsToTurnRows(records, users, parentMap);
    assert.equal(turns.length, 1, 'all four calls fold into one turn');
    const [turn] = turns;
    assert.equal(turn.callCount, 4);
    assert.equal(turn.unpricedCallCount, 2, 'the turn counts its unpriced calls');
    const byModel = Object.fromEntries(turn.children.map((c) => [c.model, c.unpriced]));
    assert.equal(byModel['gpt-5.5'], undefined, 'priced calls carry no unpriced flag');
    assert.equal(byModel['gpt-9-future'], undefined, 'nor do family-fallback calls');
    assert.equal(byModel['totally-unknown-model'], true, 'unpriced calls are flagged');
    assert.equal(byModel.constructor, true);
    console.log('✓ recordsToTurnRows: unpriced flag per call, unpricedCallCount per turn');
  }

  {
    const totals = m.aggregateTotals(records, { source: 'codex' });
    assert.equal(totals.requests, 4);
    assert.equal(totals.unpricedRequests, 2, 'totals count unpriced requests');
    assert.ok(Number.isFinite(totals.cost), 'totals stay finite');
    const models = Object.fromEntries(m.aggregateByModel(records, { source: 'codex' }).map((s) => [s.model, s]));
    assert.deepEqual(
      [models['gpt-5.5'].priced, models['gpt-5.5'].pricingResolved],
      [true, true],
      'exact: priced and resolved',
    );
    assert.deepEqual(
      [models['gpt-9-future'].priced, models['gpt-9-future'].pricingResolved],
      [true, false],
      'family fallback: priced but not resolved',
    );
    assert.deepEqual(
      [models['totally-unknown-model'].priced, models['totally-unknown-model'].pricingResolved],
      [false, false],
      'no match: neither',
    );
    console.log('✓ aggregateTotals / aggregateByModel: unpriced counts and priced vs resolved');
  }

  {
    const slot = globalThis;
    slot.__ccgaugePricing = { state: null, inflight: null };
    const scan = {};
    const first = m.recordsToTurnRowsCached(scan, 'k', records, users, parentMap);
    assert.equal(first[0].unpricedCallCount, 2);
    assert.equal(m.recordsToTurnRowsCached(scan, 'k', records, users, parentMap), first, 'same pricing reuses the cache');
    slot.__ccgaugePricing.state = {
      openai: {
        ...m.BUILTIN_PRICING_OPENAI,
        'totally-unknown-model': { input: 1, output: 2, cacheCreation5m: 0, cacheCreation1h: 0, cacheRead: 0.1 },
      },
      openaiFallback: m.FALLBACK_FAMILY_OPENAI,
    };
    const refreshed = m.recordsToTurnRowsCached(scan, 'k', records, users, parentMap);
    assert.notEqual(refreshed, first, 'a pricing change rebuilds cached turn rows');
    assert.equal(refreshed[0].unpricedCallCount, 1, 'with the newly priced model no longer flagged');
    delete slot.__ccgaugePricing;
    console.log('✓ recordsToTurnRowsCached: rows rebuild when the pricing state changes');
  }

  console.log('\nAll unpriced-marking assertions passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
