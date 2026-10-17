#!/usr/bin/env node --experimental-strip-types --no-warnings
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const {
  splitModelRoute,
  joinModelRoute,
  fullModelId,
  routedModelNames,
  routedModelTitle,
  modelRouteIncludes,
  matchesModel,
  stripModelDecoration,
} = await import(join(root, 'lib/providers/codex/model-route.js'));
const { isOpenAIPriorityModel, nearestKnownVersionKey } = await import(
  join(root, 'lib/pricing/model-family.js')
);
const { parseModelOverrides, loadModelOverrides, invalidateModelOverridesCache, overridesPath } =
  await import(join(root, 'lib/pricing/overrides.js'));
const { resolveCodexPricing, BUILTIN_PRICING_OPENAI } = await import(
  join(root, 'lib/providers/codex/pricing.ts')
);

const P = (input, output) => ({
  input,
  output,
  cacheCreation5m: 0,
  cacheCreation1h: 0,
  cacheRead: input * 0.1,
});

{
  const observed = [
    ['llm-claude/claude-sonnet-5-5', 'claude-sonnet-5-5', 'llm-claude'],
    ['llm-claude/claude-opus-5-5', 'claude-opus-5-5', 'llm-claude'],
    ['llm-claude/claude-haiku-5-5', 'claude-haiku-5-5', 'llm-claude'],
    ['cursor-plugin/claude-opus-5-5', 'claude-opus-5-5', 'cursor-plugin'],
    ['cursor-plugin/grok-4.7-fast', 'grok-4.7-fast', 'cursor-plugin'],
    ['llm-gateway/gpt-6.1-sol', 'gpt-6.1-sol', 'llm-gateway'],
    ['llm-gateway/deepseek-v4.1-flash', 'deepseek-v4.1-flash', 'llm-gateway'],
    ['chengzp/gpt-6.1-sol', 'gpt-6.1-sol', 'chengzp'],
    ['zita/gpt-6.1-sol', 'gpt-6.1-sol', 'zita'],
    ['shopee/gpt-6-astra', 'gpt-6-astra', 'shopee'],
    ['magpie/codex/gpt-6.1-sol', 'gpt-6.1-sol', 'magpie/codex'],
    ['llm-gateway--gpt-6.1-sol', 'gpt-6.1-sol', 'llm-gateway'],
    ['llm-gateway--deepseek-v4.1-flash', 'deepseek-v4.1-flash', 'llm-gateway'],
    ['mrchengzp@gmail.com--gpt-6-sol', 'gpt-6-sol', 'mrchengzp@gmail.com'],
    ['zuopeng.cheng@shopee.com--gpt-5.6-sol', 'gpt-5.6-sol', 'zuopeng.cheng@shopee.com'],
    ['grok--grok-4.6', 'grok-4.6', 'grok'],
    ['gpt-6.1-sol', 'gpt-6.1-sol', ''],
    ['codex-auto-review', 'codex-auto-review', ''],
    ['openai/gpt-5', 'gpt-5', ''],
    ['anthropic/claude-sonnet-4-5', 'claude-sonnet-4-5', ''],
    ['bedrock/claude-sonnet-4-5', 'claude-sonnet-4-5', ''],
    ['claude-opus-5-5[1M]', 'claude-opus-5-5', ''],
    ['claude-sonnet-5-5 (llm-gateway)', 'claude-sonnet-5-5', ''],
    ['llm-claude/claude-opus-5-5[1m]', 'claude-opus-5-5', 'llm-claude'],
    ['llm-claude--claude-sonnet-5-5(llm-gateway)', 'claude-sonnet-5-5', 'llm-claude'],
  ];
  for (const [raw, model, route] of observed) {
    assert.deepEqual(splitModelRoute(raw), { model, route }, raw);
    assert.deepEqual(splitModelRoute(model), { model, route: '' }, `${raw}: the model part does not split again`);
  }
  for (const raw of ['', '[1m]', '/gpt-5', 'llm-claude/', '--gpt-5.5', 'llm-gateway--', 'gpt-5--eastus', 'o3--team-a']) {
    assert.deepEqual(splitModelRoute(raw), { model: raw, route: '' }, JSON.stringify(raw));
  }
  assert.equal(stripModelDecoration('claude-opus-5-5[1M]'), 'claude-opus-5-5');
  assert.equal(stripModelDecoration('claude-sonnet-5-5(llm-gateway)'), 'claude-sonnet-5-5');
  assert.equal(stripModelDecoration('claude-opus-5-5'), 'claude-opus-5-5');
  console.log('✓ route split: slash and double-dash routes, vendor namespaces, bracket suffixes');
}

{
  assert.equal(joinModelRoute('claude-sonnet-5-5', 'llm-claude'), 'llm-claude--claude-sonnet-5-5');
  assert.deepEqual(routedModelNames('claude-sonnet-5-5', 'llm-claude'), [
    'llm-claude--claude-sonnet-5-5',
    'llm-claude/claude-sonnet-5-5',
  ]);
  assert.deepEqual(routedModelNames('gpt-5', ''), ['gpt-5']);
  const ids = (...list) => new Set(list);
  assert.equal(matchesModel(ids('llm-claude/claude-sonnet-5-5'), 'claude-sonnet-5-5', 'llm-claude'), true, 'a slash bookmark');
  assert.equal(matchesModel(ids('llm-claude--claude-sonnet-5-5'), 'claude-sonnet-5-5', 'llm-claude'), true, 'a double-dash bookmark');
  assert.equal(matchesModel(ids('claude-sonnet-5-5'), 'claude-sonnet-5-5', 'llm-claude'), true, 'a bare bookmark');
  assert.equal(matchesModel(ids('other/claude-sonnet-5-5'), 'claude-sonnet-5-5', 'llm-claude'), false, 'another route');
  assert.equal(matchesModel(ids('llm-claude/claude-sonnet-5-5'), 'claude-sonnet-5-5', undefined), false, 'an unrouted call');
  assert.equal(modelRouteIncludes('claude-sonnet-5-5', 'llm-claude', 'llm-claude/claude'), true);
  assert.equal(modelRouteIncludes('claude-sonnet-5-5', 'llm-claude', 'llm-claude--claude'), true);
  assert.equal(modelRouteIncludes('claude-sonnet-5-5', 'llm-claude', 'sonnet'), true);
  assert.equal(modelRouteIncludes('gpt-5', '', 'gpt'), true);
  assert.equal(modelRouteIncludes('gpt-5', '', 'claude'), false);
  console.log('✓ filters and search accept both route separators');
}

{
  assert.equal(fullModelId('gpt-6.1-sol', 'zita'), 'zita/gpt-6.1-sol');
  assert.equal(fullModelId('claude-sonnet-5-5', 'llm-claude'), 'llm-claude/claude-sonnet-5-5');
  assert.equal(fullModelId('gpt-5.5', ''), 'gpt-5.5');
  assert.equal(fullModelId('gpt-5.5', undefined), 'gpt-5.5');
  assert.equal(routedModelTitle(['zita/gpt-6.1-sol']), 'zita/gpt-6.1-sol');
  assert.equal(
    routedModelTitle(['llm-claude/claude-sonnet-5-5', 'codex-auto-review']),
    'llm-claude/claude-sonnet-5-5\ncodex-auto-review',
    'every model of the turn is listed once one is routed',
  );
  assert.equal(routedModelTitle(['gpt-5.5', 'claude-opus-5-5']), undefined, 'nothing to show without a route');
  assert.equal(routedModelTitle(['openai/gpt-5']), undefined, 'a vendor namespace is not a route');
  assert.equal(routedModelTitle(['llm-claude/claude-sonnet-5-5']), 'llm-claude/claude-sonnet-5-5', 'an unsplit id from an older cache still shows');
  assert.equal(routedModelTitle([]), undefined);
  console.log('✓ full model ids: route/model, shown only when a route is present');
}

{
  for (const model of ['gpt-6.1-sol', 'llm-gateway/gpt-6.1-sol', 'o3', 'o4-mini', 'codex-mini-latest', 'openai/gpt-5.5']) {
    assert.equal(isOpenAIPriorityModel(model), true, model);
  }
  for (const model of [
    'claude-sonnet-5-5',
    'llm-claude/claude-sonnet-5-5',
    'grok-4.6',
    'deepseek-v4.1-flash',
    'glm-5.3',
    'codex-auto-review',
    'llm-gateway/codex-auto-review',
    'constructor',
    '',
  ]) {
    assert.equal(isOpenAIPriorityModel(model), false, JSON.stringify(model));
  }
  console.log('✓ only OpenAI GPT-family names are priority-tier models');
}

{
  assert.equal(nearestKnownVersionKey('deepseek-v4.1-flash', BUILTIN_PRICING_OPENAI), 'deepseek-v4-flash');
  assert.equal(nearestKnownVersionKey('deepseek-v4.1-pro', BUILTIN_PRICING_OPENAI), 'deepseek-v4-pro');
  assert.equal(nearestKnownVersionKey('grok-4.7-fast', BUILTIN_PRICING_OPENAI), 'grok-4-1-fast');
  assert.equal(nearestKnownVersionKey('grok-4.1-fast', BUILTIN_PRICING_OPENAI), 'grok-4-1-fast', 'same version, different spelling');
  assert.equal(nearestKnownVersionKey('glm-9-flash', BUILTIN_PRICING_OPENAI), 'glm-5.3-flash');
  assert.equal(nearestKnownVersionKey('deepseek-v2-flash', BUILTIN_PRICING_OPENAI), null, 'older than every known version');
  assert.equal(nearestKnownVersionKey('claude-sonnet-5-5', BUILTIN_PRICING_OPENAI), null, 'a family the table does not carry');
  assert.equal(nearestKnownVersionKey('kimi-k3.5', BUILTIN_PRICING_OPENAI), null, 'no version to compare');
  assert.equal(nearestKnownVersionKey('constructor', BUILTIN_PRICING_OPENAI), null);

  const synthetic = {
    'foo-1-fast': P(1, 2),
    'foo-2-fast': P(2, 4),
    'foo-2-fast-beta': P(9, 9),
    'foo-3': P(3, 6),
    'foo-v4.5': P(5, 5),
    'foo-chat': P(1, 1),
    'baz-1-fast-20250101': P(1, 1),
  };
  assert.equal(nearestKnownVersionKey('foo-2.5-fast', synthetic), 'foo-2-fast');
  assert.equal(nearestKnownVersionKey('foo-1.5-fast', synthetic), 'foo-1-fast');
  assert.equal(nearestKnownVersionKey('foo-0.9-fast', synthetic), null, 'older than every known version');
  assert.equal(nearestKnownVersionKey('foo-2.5-turbo', synthetic), null, 'the flavor must match');
  assert.equal(nearestKnownVersionKey('foo-9', synthetic), 'foo-v4.5', 'the highest known version at or below');
  assert.equal(nearestKnownVersionKey('bar-2-fast', synthetic), null, 'another stem');
  assert.equal(nearestKnownVersionKey('foo-chat', synthetic), null, 'no version to compare');
  assert.equal(nearestKnownVersionKey('baz-1.2-fast', synthetic), 'baz-1-fast-20250101', 'a date in the key is not part of the flavor');
  console.log('✓ nearest known version: same stem and flavor, highest version at or below');
}

{
  const free = resolveCodexPricing('codex-auto-review');
  assert.equal(free.matchType, 'exact');
  assert.deepEqual(free.pricing, { input: 0, output: 0, cacheCreation5m: 0, cacheCreation1h: 0, cacheRead: 0 });
  assert.equal(resolveCodexPricing('llm-claude/claude-sonnet-5-5').matchType, 'none', 'a Claude model is not in the OpenAI table');
  const slash = resolveCodexPricing('llm-gateway/gpt-5.5');
  assert.equal(slash.matchType, 'prefix-stripped', 'a slash route resolves through its route');
  assert.deepEqual(slash.pricing, resolveCodexPricing('gpt-5.5').pricing);
  const futureGpt = resolveCodexPricing('chengzp/gpt-6.1-sol');
  assert.equal(futureGpt.matchType, 'family-fallback');
  assert.deepEqual(futureGpt.pricing, resolveCodexPricing('gpt-6.1-sol').pricing);
  const deepseek = resolveCodexPricing('llm-gateway/deepseek-v4.1-flash');
  assert.equal(deepseek.matchType, 'family-fallback');
  assert.equal(deepseek.matchedKey, 'deepseek-v4-flash');
  assert.deepEqual(deepseek.pricing, BUILTIN_PRICING_OPENAI['deepseek-v4-flash']);
  const grok = resolveCodexPricing('cursor-plugin/grok-4.7-fast');
  assert.equal(grok.matchType, 'family-fallback');
  assert.equal(grok.matchedKey, 'grok-4-1-fast');
  assert.equal(resolveCodexPricing('constructor').matchType, 'none');
  assert.equal(resolveCodexPricing('totally-unknown-model').pricing, null);
  console.log('✓ codex pricing: free auto-review, slash routes, same-family fallback');
}

{
  const valid = parseModelOverrides(
    JSON.stringify({
      aliases: { 'Codex-Auto-Review': 'gpt-5.5', 'cursor-plugin/grok-4.7-fast': ' grok-4.6 ' },
      prices: {
        'DeepSeek-V4.1-Flash': { input: 0.3, output: 1.2 },
        'llm-gateway/foo-1': { input: 1, output: 2, cacheRead: 0.5, cacheCreation5m: 1.25, cacheCreation1h: 2 },
      },
    }),
  );
  assert.deepEqual(valid.warnings, []);
  assert.equal(valid.aliases.get('codex-auto-review'), 'gpt-5.5', 'alias keys are case-insensitive');
  assert.equal(valid.aliases.get('grok-4.7-fast'), 'grok-4.6', 'a route in the key is ignored, the target is trimmed');
  assert.deepEqual(valid.prices.get('deepseek-v4.1-flash'), {
    input: 0.3,
    output: 1.2,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
    cacheRead: 0.03,
  });
  assert.deepEqual(valid.prices.get('foo-1'), {
    input: 1,
    output: 2,
    cacheCreation5m: 1.25,
    cacheCreation1h: 2,
    cacheRead: 0.5,
  });

  const broken = parseModelOverrides('{ not json');
  assert.equal(broken.warnings.length, 1);
  assert.equal(broken.aliases.size + broken.prices.size, 0);

  const bad = parseModelOverrides(
    JSON.stringify({
      aliases: { a: 5, '': 'b' },
      prices: { x: { input: -1, output: 2 }, y: { input: 1 }, z: 'free', w: { input: 1, output: 2, cacheRead: 'x' } },
    }),
  );
  assert.equal(bad.warnings.length, 6, 'every unusable entry is reported');
  assert.equal(bad.aliases.size + bad.prices.size, 0, 'and none is applied');
  assert.deepEqual(parseModelOverrides('[]').warnings, ['expected a JSON object']);
  assert.deepEqual(parseModelOverrides(JSON.stringify({ aliases: [] })).warnings, ['"aliases" must be an object']);
  assert.deepEqual(parseModelOverrides('{}').warnings, []);
  console.log('✓ model overrides: parsing, defaults and rejected entries');
}

{
  const stateDir = mkdtempSync(join(tmpdir(), 'ccgauge-overrides-'));
  const prevState = process.env.CCGAUGE_STATE_DIR;
  process.env.CCGAUGE_STATE_DIR = stateDir;
  const originalError = console.error;
  try {
    invalidateModelOverridesCache();
    assert.equal(overridesPath(), join(stateDir, 'model-overrides.json'));
    const missing = loadModelOverrides();
    assert.equal(missing.aliases.size + missing.prices.size, 0, 'no file means no overrides');

    writeFileSync(overridesPath(), JSON.stringify({ aliases: { 'codex-auto-review': 'gpt-5.5' } }), 'utf8');
    invalidateModelOverridesCache();
    const loaded = loadModelOverrides();
    assert.equal(loaded.aliases.get('codex-auto-review'), 'gpt-5.5');
    assert.equal(loadModelOverrides(), loaded, 'the next call inside the TTL is served from memory');

    writeFileSync(overridesPath(), JSON.stringify({ prices: { foo: { input: 1, output: 2 } } }), 'utf8');
    invalidateModelOverridesCache();
    const edited = loadModelOverrides();
    assert.equal(edited.aliases.size, 0, 'an edit replaces the old entries');
    assert.equal(edited.prices.get('foo').output, 2);

    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    writeFileSync(overridesPath(), '{ not json', 'utf8');
    invalidateModelOverridesCache();
    const invalid = loadModelOverrides();
    loadModelOverrides();
    assert.equal(invalid.prices.size + invalid.aliases.size, 0, 'an unreadable file applies nothing');
    assert.equal(errors.length, 1, 'and is reported once');
    assert.match(errors[0], /model-overrides\.json/);
  } finally {
    console.error = originalError;
    if (prevState === undefined) delete process.env.CCGAUGE_STATE_DIR;
    else process.env.CCGAUGE_STATE_DIR = prevState;
    invalidateModelOverridesCache();
    rmSync(stateDir, { recursive: true, force: true });
  }
  console.log('✓ model overrides: loaded from the state dir, reloaded on edit, bad file reported once');
}
