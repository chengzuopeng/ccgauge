#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-service-tier-'));
const codexDir = join(dir, '.codex');
const stateDir = join(dir, 'state');
mkdirSync(codexDir);
mkdirSync(stateDir);
const configPath = join(codexDir, 'config.toml');
const prevCodexHome = process.env.CODEX_HOME;
const prevHome = process.env.HOME;
const prevState = process.env.CCGAUGE_STATE_DIR;
process.env.CODEX_HOME = codexDir;
process.env.HOME = dir;
process.env.CCGAUGE_STATE_DIR = stateDir;

const USAGE = {
  input_tokens: 1_000_000,
  output_tokens: 100_000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 10_000_000,
  cache_creation_5m: 0,
  cache_creation_1h: 0,
};

function record(uuid, source, model, serviceTier) {
  return {
    type: 'assistant',
    source,
    uuid,
    parentUuid: 'u1',
    timestamp: `2026-10-17T10:00:0${uuid.slice(-1)}Z`,
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

const baseCost = (p) =>
  (USAGE.input_tokens * p.input + USAGE.output_tokens * p.output + USAGE.cache_read_input_tokens * p.cacheRead) / 1e6;
const near = (a, b) => Math.abs(a - b) < 1e-9;

const meta = (ts, extra = {}) => ({
  timestamp: ts,
  type: 'session_meta',
  payload: { id: 'tier-thread', cwd: '/tmp/proj', cli_version: '0.162.0', ...extra },
});
const settings = (ts, threadSettings) => ({
  timestamp: ts,
  type: 'event_msg',
  payload: { type: 'thread_settings_applied', thread_settings: threadSettings },
});
const turnContext = (ts, turnId, model) => ({
  timestamp: ts,
  type: 'turn_context',
  payload: { turn_id: turnId, cwd: '/tmp/proj', model, effort: 'high' },
});
const userMessage = (ts, text) => ({
  timestamp: ts,
  type: 'event_msg',
  payload: { type: 'user_message', message: text },
});
const tokens = (ts, n) => ({
  timestamp: ts,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: {
        input_tokens: 1000 * n,
        cached_input_tokens: 0,
        output_tokens: 100 * n,
        reasoning_output_tokens: 0,
      },
    },
  },
});

function writeRollout(name, events) {
  const file = join(dir, name);
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return file;
}

try {
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      "export { parseCodexJsonlFile } from '@/lib/providers/codex/parse-codex-jsonl';",
      "export { pricedCostOfRecord } from '@/lib/pricing/calculate';",
      "export { resolvePricing } from '@/lib/pricing/resolve';",
      "export { recordsToTurnRows } from '@/lib/serialize';",
      "export { codexFastMultiplier, codexCallIsFast, invalidateCodexTierCache } from '@/lib/providers/codex/speed';",
      "export { codexAdapter } from '@/lib/providers/codex';",
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

  const setConfig = (tier) => {
    writeFileSync(configPath, `model = "gpt-6.1-sol"\nservice_tier = "${tier}"\n`, 'utf8');
    m.invalidateCodexTierCache();
  };

  {
    const file = writeRollout('tiers.jsonl', [
      meta('2026-10-17T09:00:00Z'),
      userMessage('2026-10-17T09:00:01Z', 'hello'),
      turnContext('2026-10-17T09:00:02Z', 't-1', 'gpt-6.1-sol'),
      tokens('2026-10-17T09:00:03Z', 1),
      settings('2026-10-17T09:00:04Z', { model: 'gpt-6.1-sol', service_tier: 'priority' }),
      tokens('2026-10-17T09:00:05Z', 2),
      settings('2026-10-17T09:00:06Z', { model: 'gpt-6.1-sol' }),
      tokens('2026-10-17T09:00:07Z', 3),
      settings('2026-10-17T09:00:08Z', { model: 'gpt-6.1-sol', service_tier: 'default' }),
      tokens('2026-10-17T09:00:09Z', 4),
      settings('2026-10-17T09:00:10Z', { model: 'gpt-6.1-sol', service_tier: null }),
      settings('2026-10-17T09:00:11Z', { model: 'gpt-6.1-sol', service_tier: '' }),
      tokens('2026-10-17T09:00:12Z', 5),
      settings('2026-10-17T09:00:13Z', { model: 'gpt-6.1-sol', service_tier: 'fast' }),
      tokens('2026-10-17T09:00:14Z', 6),
      settings('2026-10-17T09:00:15Z', { model: 'gpt-6.1-sol', service_tier: 'flex' }),
      tokens('2026-10-17T09:00:16Z', 7),
    ]);
    const parsed = await m.parseCodexJsonlFile(file);
    const tiers = parsed.assistant.map((r) => r.serviceTier);
    assert.equal(parsed.assistant.length, 7);
    assert.equal('serviceTier' in parsed.assistant[0], false, 'before any recorded tier the field is absent, not "default"');
    assert.deepEqual(
      tiers,
      [undefined, 'priority', 'priority', 'default', 'default', 'priority', 'default'],
      'each call carries the latest tier recorded before it; a settings event without one changes nothing',
    );
    for (const r of parsed.assistant) assert.equal(r.model, 'gpt-6.1-sol', 'the tier never touches the model');
    console.log('✓ parser: each call takes the latest thread_settings_applied service_tier recorded before it');
  }

  {
    const file = writeRollout('turn-context-first.jsonl', [
      meta('2026-10-17T09:10:00Z'),
      userMessage('2026-10-17T09:10:01Z', 'hello'),
      turnContext('2026-10-17T09:10:02Z', 't-1', 'gpt-6.1-sol'),
      settings('2026-10-17T09:10:03Z', { model: 'gpt-5.6-terra', service_tier: 'priority' }),
      tokens('2026-10-17T09:10:04Z', 1),
    ]);
    const parsed = await m.parseCodexJsonlFile(file);
    assert.equal(parsed.assistant[0].model, 'gpt-6.1-sol', 'turn_context still owns the model');
    assert.equal(parsed.assistant[0].serviceTier, 'priority', 'a settings event after turn_context still supplies the tier');
    console.log('✓ parser: a thread_settings_applied after turn_context supplies the tier but not the model');
  }

  {
    const file = writeRollout('exec.jsonl', [
      meta('2026-10-17T09:20:00Z', { originator: 'codex_exec' }),
      userMessage('2026-10-17T09:20:01Z', 'run it'),
      turnContext('2026-10-17T09:20:02Z', 't-1', 'zita/gpt-6.1-sol'),
      tokens('2026-10-17T09:20:03Z', 1),
      tokens('2026-10-17T09:20:04Z', 2),
    ]);
    const parsed = await m.parseCodexJsonlFile(file);
    assert.equal(parsed.assistant.length, 2);
    for (const r of parsed.assistant) {
      assert.equal('serviceTier' in r, false, 'a rollout that never records a tier leaves the field absent');
    }
    console.log('✓ parser: codex_exec style rollouts record no tier');
  }

  {
    const gpt = 'gpt-6.1-sol';
    const price = m.resolvePricing(gpt, 'codex').pricing;
    const price55 = m.resolvePricing('gpt-5.5', 'codex').pricing;
    const base = baseCost(price);

    for (const config of ['priority', 'default']) {
      setConfig(config);
      assert.equal(m.codexFastMultiplier(gpt, 'priority'), 2, `a recorded priority tier multiplies (config ${config})`);
      assert.equal(m.codexFastMultiplier(gpt, 'default'), 1, `a recorded default tier does not (config ${config})`);
      assert.equal(m.codexFastMultiplier(gpt), 1, `an unrecorded call bills standard whatever config.toml says (config ${config})`);
      assert.equal(m.codexFastMultiplier('gpt-5.5', 'priority'), 2.5);
      assert.equal(m.codexFastMultiplier('gpt-5.5', 'default'), 1);
      assert.equal(m.codexCallIsFast(gpt, 'default'), false);
      assert.equal(m.codexCallIsFast(gpt, 'priority'), true);
      assert.equal(m.codexCallIsFast(gpt), false);

      assert.ok(near(m.pricedCostOfRecord(record('a1', 'codex', gpt, 'priority')).cost.total, 2 * base));
      assert.ok(near(m.pricedCostOfRecord(record('a2', 'codex', gpt, 'default')).cost.total, base), 'default is billed at the standard rate');
      assert.ok(near(m.pricedCostOfRecord(record('a3', 'codex', gpt)).cost.total, base), 'unrecorded is billed at the standard rate');
      assert.ok(near(m.pricedCostOfRecord(record('a4', 'codex', 'gpt-5.5', 'priority')).cost.total, 2.5 * baseCost(price55)));
      assert.ok(near(m.pricedCostOfRecord(record('a5', 'codex', 'llm-gateway/gpt-6.1-sol', 'priority')).cost.total, 2 * base), 'a route does not hide the model');
      for (const model of ['llm-claude/claude-sonnet-5-5', 'deepseek-v4.1-flash', 'grok-4.6', 'codex-auto-review']) {
        assert.equal(m.codexFastMultiplier(model, 'priority'), 1, `${model} has no priority tier (config ${config})`);
        assert.equal(m.codexCallIsFast(model, 'priority'), false);
      }
      const claudeNative = m.pricedCostOfRecord(record('c1', 'claude', 'claude-sonnet-5-5')).cost.total;
      const claudeViaCodex = m.pricedCostOfRecord(record('c2', 'codex', 'llm-claude/claude-sonnet-5-5', 'priority')).cost.total;
      assert.equal(claudeViaCodex, claudeNative, 'a recorded priority tier never inflates a Claude model');
    }
    console.log('✓ cost: only a recorded priority tier multiplies, config.toml no longer decides, non-GPT models never multiply');
  }

  {
    const users = [
      {
        type: 'user',
        source: 'codex',
        uuid: 'u1',
        parentUuid: null,
        timestamp: '2026-10-17T10:00:00Z',
        sessionId: 's1',
        cwd: '/tmp/proj',
        textPreview: 'hello',
        filePath: '/tmp/proj/s1.jsonl',
      },
    ];
    const records = [
      record('a1', 'codex', 'gpt-6.1-sol', 'priority'),
      record('a2', 'codex', 'gpt-6.1-sol', 'default'),
      record('a3', 'codex', 'gpt-6.1-sol'),
      record('a4', 'codex', 'llm-claude/claude-sonnet-5-5', 'priority'),
    ];
    const parentMap = { u1: null, a1: 'u1', a2: 'u1', a3: 'u1', a4: 'u1' };

    for (const config of ['priority', 'default']) {
      setConfig(config);
      const [turn] = m.recordsToTurnRows(records, users, parentMap);
      const byId = Object.fromEntries(turn.children.map((c) => [c.uuid, c]));
      assert.equal(byId.a1.fast, true, 'a priority call is marked');
      assert.equal(byId.a2.fast, undefined, `a default call is not marked (config ${config})`);
      assert.equal(byId.a3.fast, undefined, `an unrecorded call is not marked (config ${config})`);
      assert.equal(byId.a4.fast, undefined, 'a non-GPT call is never marked');
      assert.equal(turn.fastCallCount, 1);
      assert.ok(near(byId.a1.cost, 2 * byId.a2.cost), 'the marked call costs twice the unmarked one');
      assert.ok(near(byId.a3.cost, byId.a2.cost), 'an unrecorded call costs the same as a default one');
    }

    const claudeTurn = m.recordsToTurnRows(
      [record('a1', 'claude', 'claude-sonnet-5-5')],
      users.map((u) => ({ ...u, source: 'claude' })),
      { u1: null, a1: 'u1' },
    )[0];
    assert.equal(claudeTurn.fastCallCount, 0);
    assert.equal(claudeTurn.children[0].fast, undefined);
    console.log('✓ turn rows: fast marks and fastCallCount follow each call, not config.toml');
  }

  {
    const file = writeRollout('end-to-end.jsonl', [
      meta('2026-10-17T11:00:00Z'),
      userMessage('2026-10-17T11:00:01Z', 'hello'),
      turnContext('2026-10-17T11:00:02Z', 't-1', 'gpt-6.1-sol'),
      tokens('2026-10-17T11:00:03Z', 1),
      settings('2026-10-17T11:00:04Z', { model: 'gpt-6.1-sol', service_tier: 'default' }),
      tokens('2026-10-17T11:00:05Z', 2),
      tokens('2026-10-17T11:00:06Z', 3),
      settings('2026-10-17T11:00:07Z', { model: 'gpt-6.1-sol', service_tier: 'priority' }),
      tokens('2026-10-17T11:00:08Z', 4),
    ]);
    const parsed = await m.parseCodexJsonlFile(file);
    for (const config of ['priority', 'default']) {
      setConfig(config);
      const costs = parsed.assistant.map((r) => m.pricedCostOfRecord(r).cost.total);
      const unit = costs[1];
      assert.ok(unit > 0);
      assert.ok(near(costs[0], unit), `the unrecorded first call bills standard (config ${config})`);
      assert.ok(near(costs[2], unit), 'a default call after a default call costs the same');
      assert.ok(near(costs[3], 2 * unit), 'a priority call bills at the multiplier');
    }
    console.log('✓ end to end: a parsed rollout bills each call at the tier its thread recorded, unrecorded at standard');
  }

  {
    assert.equal(m.codexAdapter.parserVersion, 'codex-v19-service-tier');
    console.log('✓ the Codex parser version records the tier change');
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

console.log('\nAll service-tier assertions passed.');
