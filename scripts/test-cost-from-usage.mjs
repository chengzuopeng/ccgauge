#!/usr/bin/env node --experimental-strip-types --no-warnings

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { costFromUsage, totalTokens } = await import(
  join(root, 'lib/pricing/cost-from-usage.ts')
);

const PRICING = {
  input: 15,
  output: 75,
  cacheCreation5m: 18.75,
  cacheCreation1h: 30,
  cacheRead: 1.5,
};

const ZERO_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_5m: 0,
  cache_creation_1h: 0,
};

{
  const c = costFromUsage(
    { ...ZERO_USAGE, input_tokens: 1_000_000, output_tokens: 1_000_000 },
    null,
  );
  assert.equal(c.total, 0);
  assert.equal(c.input, 0);
  assert.equal(c.output, 0);
  assert.equal(c.cacheCreation5m, 0);
  assert.equal(c.cacheCreation1h, 0);
  assert.equal(c.cacheRead, 0);
  assert.equal(c.saved, 0);
  console.log('✓ null pricing → all zeros');
}

{
  const c = costFromUsage(
    { ...ZERO_USAGE, input_tokens: 500_000, output_tokens: 200_000 },
    PRICING,
  );
  assert.equal(c.input.toFixed(2), '7.50', '500k @ $15/M = $7.50');
  assert.equal(c.output.toFixed(2), '15.00', '200k @ $75/M = $15.00');
  assert.equal(c.total.toFixed(2), '22.50');
  assert.equal(c.saved, 0, 'no cache reads → no savings');
  console.log('✓ basic input + output pricing math');
}

{
  const c = costFromUsage(
    {
      ...ZERO_USAGE,
      cache_creation_5m: 1_000_000,
      cache_creation_1h: 2_000_000,

      cache_creation_input_tokens: 3_000_000,
    },
    PRICING,
  );
  assert.equal(c.cacheCreation5m.toFixed(2), '18.75', '1M @ $18.75/M');
  assert.equal(c.cacheCreation1h.toFixed(2), '60.00', '2M @ $30/M');
  assert.equal(c.total.toFixed(2), '78.75', 'NO double-count of legacy aggregate');
  console.log('✓ new-shape (5m + 1h split): legacy aggregate is ignored');
}

{
  const c = costFromUsage(
    {
      ...ZERO_USAGE,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      cache_creation_input_tokens: 2_000_000,
    },
    PRICING,
  );
  assert.equal(c.cacheCreation5m.toFixed(2), '37.50', 'legacy: 2M @ $18.75/M (5m rate)');
  assert.equal(c.cacheCreation1h, 0);
  assert.equal(c.total.toFixed(2), '37.50');
  console.log('✓ legacy-shape (no 5m/1h split): falls back to 5m rate');
}

{
  const c = costFromUsage(
    {
      ...ZERO_USAGE,
      cache_read_input_tokens: 4_000_000,
    },
    PRICING,
  );
  assert.equal(c.cacheRead.toFixed(2), '6.00', '4M @ $1.50/M');

  assert.equal(c.saved.toFixed(2), '54.00', 'saved = full-input − cache-read price');
  assert.equal(c.total.toFixed(2), '6.00');
  console.log('✓ cache read: cost + saved-vs-full-input');
}

{
  const usage = {
    ...ZERO_USAGE,
    input_tokens: 100,
    output_tokens: 200,
    cache_read_input_tokens: 300,
    cache_creation_input_tokens: 50,
  };
  assert.equal(totalTokens(usage), 650, '100 + 200 + 300 + 50');
  console.log('✓ totalTokens sums all four counters');
}

{
  const c = costFromUsage(ZERO_USAGE, PRICING);
  assert.equal(c.total, 0);
  assert.equal(c.saved, 0);
  console.log('✓ all-zero usage → zero cost (no NaN)');
}

{
  const c = costFromUsage(
    { ...ZERO_USAGE, input_tokens: 1, output_tokens: 1 },
    PRICING,
  );
  assert.ok(c.input > 0, '1 input token has nonzero cost');
  assert.ok(c.output > 0, '1 output token has nonzero cost');
  assert.equal((c.input * 1e6).toFixed(2), '15.00', '1 token × $15/M scales linearly');
  console.log('✓ single-token requests scale linearly without underflow');
}

console.log('\nAll cost-from-usage assertions passed.');
