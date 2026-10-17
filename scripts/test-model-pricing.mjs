#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-model-pricing-'));

const USAGE = {
  input_tokens: 1_000_000,
  output_tokens: 100_000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 10_000_000,
  cache_creation_5m: 0,
  cache_creation_1h: 0,
};

function assistant(uuid, source, model, serviceTier) {
  return {
    type: 'assistant',
    source,
    uuid,
    parentUuid: 'u1',
    timestamp: `2026-10-15T10:00:0${uuid.slice(-1)}Z`,
    sessionId: 's1',
    requestId: `r-${uuid}`,
    cwd: '/tmp/proj',
    model,
    messageId: `m-${uuid}`,
    usage: { ...USAGE },
    toolNames: [],
    hasThinking: false,
    textPreview: '',
    filePath: '/tmp/proj/s1.jsonl',
    ...(serviceTier ? { serviceTier } : {}),
  };
}

const baseCost = (p) => (USAGE.input_tokens * p.input + USAGE.output_tokens * p.output + USAGE.cache_read_input_tokens * p.cacheRead) / 1e6;
const near = (a, b) => Math.abs(a - b) < 1e-9;

const codexDir = join(dir, '.codex');
const stateDir = join(dir, 'state');
mkdirSync(codexDir);
mkdirSync(stateDir);
writeFileSync(join(codexDir, 'config.toml'), 'service_tier = "priority"\n', 'utf8');
const prevCodexHome = process.env.CODEX_HOME;
const prevHome = process.env.HOME;
const prevState = process.env.CCGAUGE_STATE_DIR;
process.env.CODEX_HOME = codexDir;
process.env.HOME = dir;
process.env.CCGAUGE_STATE_DIR = stateDir;

try {
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      "export { resolvePricing, isResolvedMatch } from '@/lib/pricing/resolve';",
      "export { pricedCostOfRecord } from '@/lib/pricing/calculate';",
      "export { aggregateByModel } from '@/lib/aggregator';",
      "export { recordsToTurnRows } from '@/lib/serialize';",
      "export { invalidateModelOverridesCache, overridesPath } from '@/lib/pricing/overrides.js';",
      "export { invalidateCodexTierCache } from '@/lib/providers/codex/speed';",
      "export { shortenModel } from '@/lib/utils';",
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
  m.invalidateCodexTierCache();
  m.invalidateModelOverridesCache();

  {
    const viaCodex = m.resolvePricing('llm-claude/claude-sonnet-5-5', 'codex');
    const native = m.resolvePricing('claude-sonnet-5-5', 'claude');
    assert.ok(viaCodex.pricing, 'a Claude model seen through Codex is priced');
    assert.deepEqual(viaCodex.pricing, native.pricing, 'at the Claude price');
    assert.equal(viaCodex.matchType, 'family-fallback');
    assert.equal(m.isResolvedMatch(viaCodex.matchType), false, 'and flagged as a fallback price');
    assert.equal(m.resolvePricing('cursor-plugin/claude-opus-4-8', 'codex').matchType, 'exact', 'a known Claude id is an exact hit');
    const gptViaClaude = m.resolvePricing('gpt-6.1-sol', 'claude');
    assert.ok(gptViaClaude.pricing, 'a GPT model in a Claude transcript is priced too');
    assert.equal(gptViaClaude.matchType, 'family-fallback');
    const free = m.resolvePricing('codex-auto-review', 'codex');
    assert.equal(free.matchType, 'exact');
    assert.equal(m.isResolvedMatch(free.matchType), true);
    assert.deepEqual(free.pricing, { input: 0, output: 0, cacheCreation5m: 0, cacheCreation1h: 0, cacheRead: 0 }, 'auto-review is free');
    assert.equal(m.resolvePricing('codex-auto-review', 'claude').pricing.input, 0, 'whichever provider asks');
    for (const model of ['totally-unknown-model', 'constructor', '__proto__', '']) {
      for (const source of ['claude', 'codex']) {
        const r = m.resolvePricing(model, source);
        assert.equal(r.pricing, null, `${JSON.stringify(model)} via ${source} is unpriced`);
        assert.equal(r.matchType, 'none');
      }
    }
    console.log('✓ resolvePricing: the price table follows the model, not the record source');
  }

  {
    const gptPrice = m.resolvePricing('gpt-6.1-sol', 'codex').pricing;
    const gpt = m.pricedCostOfRecord(assistant('a3', 'codex', 'llm-gateway/gpt-6.1-sol', 'priority'));
    assert.ok(near(gpt.cost.total, 2 * baseCost(gptPrice)), 'a GPT model keeps the fast multiplier');

    const review = m.pricedCostOfRecord(assistant('a5', 'codex', 'codex-auto-review'));
    assert.equal(review.priced, true, 'auto-review is priced, not unpriced');
    assert.equal(review.cost.total, 0, 'at $0');
    console.log('✓ pricedCostOfRecord: GPT multiplier, free auto-review');
  }

  {
    const users = [
      {
        type: 'user',
        source: 'codex',
        uuid: 'u1',
        parentUuid: null,
        timestamp: '2026-10-15T10:00:00Z',
        sessionId: 's1',
        cwd: '/tmp/proj',
        textPreview: 'hello',
        filePath: '/tmp/proj/s1.jsonl',
      },
    ];
    const records = [
      assistant('a1', 'codex', 'claude-sonnet-5-5'),
      assistant('a2', 'codex', 'claude-sonnet-5-5'),
      assistant('a3', 'codex', 'codex-auto-review'),
      assistant('a4', 'codex', 'llm-claude/claude-sonnet-5-5'),
    ];
    const parentMap = { u1: null, a1: 'u1', a2: 'u1', a3: 'u1', a4: 'u1' };
    const [turn] = m.recordsToTurnRows(records, users, parentMap);
    assert.equal(turn.callCount, 4);
    assert.equal(turn.unpricedCallCount, 0, 'a turn of Claude calls and auto-review calls has nothing unpriced');
    assert.ok(turn.cost > 0, 'and a cost');
    assert.equal(turn.children.find((c) => c.model === 'codex-auto-review').cost, 0);
    assert.ok(turn.children.filter((c) => c.model !== 'codex-auto-review').every((c) => c.cost > 0 && c.unpriced === undefined));

    const models = Object.fromEntries(m.aggregateByModel(records, { source: 'codex' }).map((s) => [s.model, s]));
    assert.deepEqual([models['claude-sonnet-5-5'].priced, models['claude-sonnet-5-5'].pricingResolved], [true, false]);
    assert.deepEqual([models['codex-auto-review'].priced, models['codex-auto-review'].pricingResolved], [true, true]);
    console.log('✓ turns and models: no unpriced calls left in a magpie Claude turn');
  }

  {
    writeFileSync(
      m.overridesPath(),
      JSON.stringify({
        prices: {
          'deepseek-v4.1-flash': { input: 1, output: 2, cacheRead: 0.1 },
          'gpt-6.1-sol': { input: 7, output: 8 },
        },
        aliases: {
          'codex-auto-review': 'gpt-5.5',
          'cursor-plugin/grok-4.7-fast': 'grok-4.6',
          'foo-alias': 'gpt-6.1-sol',
        },
      }),
      'utf8',
    );
    m.invalidateModelOverridesCache();

    const deepseek = m.resolvePricing('llm-gateway/deepseek-v4.1-flash', 'codex');
    assert.equal(deepseek.matchType, 'override');
    assert.equal(deepseek.pricing.input, 1);
    assert.equal(m.isResolvedMatch(deepseek.matchType), true, 'an override is an authoritative price');
    assert.equal(m.resolvePricing('gpt-6.1-sol', 'codex').pricing.input, 7, 'an override beats the family fallback');

    const review = m.resolvePricing('codex-auto-review', 'codex');
    assert.equal(review.matchedKey, 'gpt-5.5');
    assert.deepEqual(review.pricing, m.resolvePricing('gpt-5.5', 'codex').pricing, 'an alias prices as its target');
    const grok = m.resolvePricing('cursor-plugin/grok-4.7-fast', 'codex');
    assert.deepEqual(grok.pricing, m.resolvePricing('grok-4.6', 'codex').pricing);
    assert.equal(grok.matchType, 'exact');
    assert.equal(m.resolvePricing('foo-alias', 'codex').pricing.input, 7, 'an alias to an overridden model uses the override');

    const aliased = m.pricedCostOfRecord(assistant('a5', 'codex', 'codex-auto-review'));
    assert.ok(aliased.cost.total > 0, 'so an aliased auto-review costs money again');

    rmSync(m.overridesPath());
    m.invalidateModelOverridesCache();
    assert.equal(m.resolvePricing('codex-auto-review', 'codex').pricing.input, 0, 'removing the file restores the defaults');
    console.log('✓ model-overrides.json: prices beat fallbacks, aliases price as their target');
  }

  {
    assert.equal(m.shortenModel('llm-claude/claude-sonnet-5-5'), 'Sonnet 5.5');
    assert.equal(m.shortenModel('cursor-plugin/claude-opus-5-5'), 'Opus 5.5');
    assert.equal(m.shortenModel('claude-opus-5-5[1M]'), 'Opus 5.5');
    assert.equal(m.shortenModel('chengzp/gpt-6.1-sol'), 'GPT-6.1 sol');
    assert.equal(m.shortenModel('claude-sonnet-5-5'), 'Sonnet 5.5');
    console.log('✓ labels: routes and suffixes no longer leak into the model name');
  }
} finally {
  if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = prevCodexHome;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevState === undefined) delete process.env.CCGAUGE_STATE_DIR;
  else process.env.CCGAUGE_STATE_DIR = prevState;
  rmSync(dir, { recursive: true, force: true });
}
