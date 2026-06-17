#!/usr/bin/env node --experimental-strip-types --no-warnings
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { LITELLM_CLAUDE_PRICING, LITELLM_OPENAI_PRICING } = await import(
  join(root, 'lib/pricing/litellm-pricing.generated.js')
);
const { BUILTIN_PRICING, FALLBACK_BY_FAMILY } = await import(join(root, 'lib/pricing/builtin.ts'));
const { BUILTIN_PRICING_OPENAI, resolveCodexPricing } = await import(
  join(root, 'lib/providers/codex/pricing.ts')
);

// Both snapshot sections are populated.
assert.ok(Object.keys(LITELLM_CLAUDE_PRICING).length > 5, 'claude snapshot non-empty');
assert.ok(Object.keys(LITELLM_OPENAI_PRICING).length > 5, 'openai snapshot non-empty');
console.log(
  `✓ snapshot loaded: ${Object.keys(LITELLM_CLAUDE_PRICING).length} claude, ${Object.keys(LITELLM_OPENAI_PRICING).length} openai`,
);

function eq(p, exp, label) {
  assert.ok(p, `${label}: present`);
  assert.deepEqual(
    {
      input: p.input,
      output: p.output,
      cacheCreation5m: p.cacheCreation5m,
      cacheCreation1h: p.cacheCreation1h,
      cacheRead: p.cacheRead,
    },
    exp,
    label,
  );
}

// Sample values sourced from LiteLLM (via BUILTIN_PRICING / BUILTIN_PRICING_OPENAI merge).
eq(
  BUILTIN_PRICING['claude-opus-4-8'],
  { input: 5, output: 25, cacheCreation5m: 6.25, cacheCreation1h: 10, cacheRead: 0.5 },
  'claude-opus-4-8',
);
eq(
  BUILTIN_PRICING['claude-haiku-4-5'],
  { input: 1, output: 5, cacheCreation5m: 1.25, cacheCreation1h: 2, cacheRead: 0.1 },
  'claude-haiku-4-5',
);
eq(
  BUILTIN_PRICING_OPENAI['gpt-5.5'],
  { input: 5, output: 30, cacheCreation5m: 0, cacheCreation1h: 0, cacheRead: 0.5 },
  'gpt-5.5',
);
eq(
  BUILTIN_PRICING_OPENAI['gpt-5.2-codex'],
  { input: 1.75, output: 14, cacheCreation5m: 0, cacheCreation1h: 0, cacheRead: 0.175 },
  'gpt-5.2-codex',
);
// The 4 values that flipped from ccgauge's old hand-curated table to LiteLLM.
eq(
  BUILTIN_PRICING_OPENAI['gpt-5'],
  { input: 1.25, output: 10, cacheCreation5m: 0, cacheCreation1h: 0, cacheRead: 0.125 },
  'gpt-5 → LiteLLM 1.25/10',
);
assert.equal(BUILTIN_PRICING_OPENAI['gpt-5-mini'].input, 0.25, 'gpt-5-mini → 0.25');
assert.equal(BUILTIN_PRICING_OPENAI['gpt-5-codex'].output, 10, 'gpt-5-codex → 10');
console.log('✓ sample values match LiteLLM (incl. the 4 flipped gpt-5* values)');

// Transform invariant: Anthropic 1h-cache write = 2x input wherever a 5m cost exists.
for (const [m, p] of Object.entries(LITELLM_CLAUDE_PRICING)) {
  if (p.cacheCreation5m > 0) {
    assert.ok(
      Math.abs(p.cacheCreation1h - p.input * 2) < 1e-6,
      `${m}: cacheCreation1h (${p.cacheCreation1h}) must equal 2x input (${p.input})`,
    );
  }
}
// OpenAI never has cache-write cost in our sampled models.
for (const m of ['gpt-5.5', 'gpt-5.3-codex', 'gpt-5', 'gpt-5-mini', 'o3']) {
  const p = BUILTIN_PRICING_OPENAI[m];
  assert.equal(p.cacheCreation5m, 0, `${m}: cacheCreation5m == 0`);
  assert.equal(p.cacheCreation1h, 0, `${m}: cacheCreation1h == 0`);
}
console.log('✓ invariants: Anthropic cc1h = 2x input; OpenAI cache-creation tiers = 0');

// Hand-maintained gap models (absent from LiteLLM) still resolve via the merge.
assert.ok(BUILTIN_PRICING['claude-opus-4'], 'gap model claude-opus-4 present (hand layer)');
assert.equal(BUILTIN_PRICING['claude-opus-4'].output, 75, 'claude-opus-4 = 15/75');
assert.ok(BUILTIN_PRICING['claude-sonnet-4'], 'gap model claude-sonnet-4 present (hand layer)');

// Family fallbacks are wired to real snapshot entries.
for (const fam of ['fable', 'opus', 'sonnet', 'haiku']) {
  assert.ok(FALLBACK_BY_FAMILY[fam], `claude family fallback '${fam}' resolved`);
}
assert.equal(resolveCodexPricing('gpt-5.5').matchType, 'exact', 'gpt-5.5 resolves exact from snapshot');
assert.equal(resolveCodexPricing('gpt-9-future').matchType, 'family-fallback', 'unknown gpt → fallback');
console.log('✓ gap-model + family fallbacks resolve');

console.log('\nAll pricing-snapshot assertions passed.');
