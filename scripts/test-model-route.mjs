#!/usr/bin/env node --experimental-strip-types --no-warnings
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
