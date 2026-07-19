#!/usr/bin/env node --experimental-strip-types --no-warnings
// Unit tests for the runtime pricing store's pure logic (merge / validation /
// fallback rebuild) and the loose globalThis slot contract that provider
// resolvers read. The store's IO/fetch/TTL orchestration (store.ts) has
// extensionless value imports that raw strip-types can't load, so it's exercised
// end-to-end in the browser instead; here we test the extracted, dependency-free
// helpers plus the slot the providers actually read.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { validatePricingTables, mergeOverlay, buildFallback, isValidPricing } = await import(
  join(root, 'lib/pricing/merge.js')
);
const { BUILTIN_PRICING } = await import(join(root, 'lib/pricing/builtin.ts'));
const { BUILTIN_PRICING_OPENAI, resolveCodexPricing } = await import(
  join(root, 'lib/providers/codex/pricing.ts')
);

const P = (input, output) => ({
  input,
  output,
  cacheCreation5m: 0,
  cacheCreation1h: 0,
  cacheRead: input * 0.1,
});

// ── validation gate ──────────────────────────────────────────────────────────
assert.equal(
  validatePricingTables(BUILTIN_PRICING, BUILTIN_PRICING_OPENAI),
  null,
  'committed snapshot passes validation',
);
assert.match(
  validatePricingTables({}, BUILTIN_PRICING_OPENAI) ?? '',
  /claude count 0/,
  'empty claude table rejected on count floor',
);
assert.match(
  validatePricingTables(BUILTIN_PRICING, {}) ?? '',
  /openai count 0/,
  'empty openai table rejected on count floor',
);
{
  // Enough entries to clear the floor, but none look like real model keys.
  const claudeMislabeled = {};
  for (let i = 0; i < 20; i++) claudeMislabeled[`x${i}`] = P(1, 5);
  assert.match(
    validatePricingTables(claudeMislabeled, BUILTIN_PRICING_OPENAI) ?? '',
    /no claude-\* key/,
    'table without a claude-* key rejected',
  );
}
{
  // A single NaN cost must sink the whole table (would poison cost math).
  const poisoned = { ...BUILTIN_PRICING_OPENAI, 'gpt-5.5': { ...BUILTIN_PRICING_OPENAI['gpt-5.5'], input: NaN } };
  assert.match(
    validatePricingTables(BUILTIN_PRICING, poisoned) ?? '',
    /bad openai entry gpt-5\.5/,
    'NaN cost rejected',
  );
}
assert.equal(isValidPricing(P(1, 5)), true, 'valid pricing accepted');
assert.equal(isValidPricing({ input: -1, output: 5, cacheCreation5m: 0, cacheCreation1h: 0, cacheRead: 0 }), false, 'negative cost rejected');
console.log('✓ validation: floors, key-shape, and NaN/negative guards');

// ── merge priority ───────────────────────────────────────────────────────────
{
  const base = { a: P(1, 2), b: P(3, 4) };
  const overlay = { b: P(30, 40), c: P(5, 6) };
  const merged = mergeOverlay(base, overlay);
  assert.equal(merged.a.input, 1, 'base-only key survives');
  assert.equal(merged.b.input, 30, 'overlay wins for shared key');
  assert.equal(merged.c.input, 5, 'overlay-only key appears');
  assert.notEqual(mergeOverlay(base, null), base, 'null overlay returns a fresh clone, not the base ref');
  assert.equal(mergeOverlay(base, null).a.input, 1, 'null overlay preserves base values');
}
console.log('✓ merge: overlay wins, base survives, new keys appear');

// ── fallback rebuild from merged map ─────────────────────────────────────────
{
  const map = { 'claude-fable-5': P(10, 50), 'claude-opus-4-8': P(5, 25) };
  const fb = buildFallback(map, { fable: 'claude-fable-5', opus: 'claude-opus-4-8', missing: 'claude-nope' });
  assert.equal(fb.fable.input, 10, 'fable anchor resolved from merged map');
  assert.equal(fb.opus.input, 5, 'opus anchor resolved from merged map');
  assert.equal('missing' in fb, false, 'absent anchor omitted');
}
console.log('✓ fallback: anchors resolved from merged map, absent anchors omitted');

// ── globalThis slot contract (what provider resolvers read) ───────────────────
const slot = globalThis;
delete slot.__ccgaugePricing;
// With no slot, resolve uses the built-in base.
assert.equal(resolveCodexPricing('gpt-5.5').pricing.input, BUILTIN_PRICING_OPENAI['gpt-5.5'].input, 'no slot → built-in base');

// Publish a realistic merged overlay: full base + one bumped price + one new model.
const merged = mergeOverlay(BUILTIN_PRICING_OPENAI, { 'gpt-5.5': P(99, 99), 'gpt-9-neo': P(7, 8) });
slot.__ccgaugePricing = {
  state: { openai: merged, openaiFallback: buildFallback(merged, { gpt: 'gpt-5.5', o: 'o3' }) },
};
try {
  assert.equal(resolveCodexPricing('gpt-5.5').pricing.input, 99, 'slot overlay wins for a bumped model');
  assert.equal(resolveCodexPricing('gpt-5.5').matchType, 'exact', 'bumped model still matches exact');
  assert.equal(resolveCodexPricing('gpt-5').pricing.input, BUILTIN_PRICING_OPENAI['gpt-5'].input, 'base-only model survives under slot');
  const neo = resolveCodexPricing('gpt-9-neo');
  assert.equal(neo.matchType, 'exact', 'overlay-only new model resolves exact');
  assert.equal(neo.pricing.input, 7, 'overlay-only new model uses overlay price');
  const fb = resolveCodexPricing('gpt-unknown-xyz');
  assert.equal(fb.matchType, 'family-fallback', 'unknown gpt → family fallback');
  assert.equal(fb.pricing.input, 99, 'family fallback reads the slot fallback (bumped gpt-5.5)');
} finally {
  delete slot.__ccgaugePricing;
}
console.log('✓ slot contract: providers read the overlay, fall back to base when absent');

console.log('\nAll pricing-store assertions passed.');
