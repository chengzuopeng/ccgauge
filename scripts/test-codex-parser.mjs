#!/usr/bin/env node --experimental-strip-types --no-warnings
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { parseCodexJsonlFile } = await import(join(root, 'lib/providers/codex/parse-codex-jsonl.ts'));
const { resolveCodexPricing, BUILTIN_PRICING_OPENAI } = await import(join(root, 'lib/providers/codex/pricing.ts'));
const { costFromUsage } = await import(join(root, 'lib/pricing/cost-from-usage.ts'));
const { shortenCodexModel } = await import(join(root, 'lib/providers/codex/shorten-model.ts'));
const {
  scaleCodexPricing,
  codexFastMultiplier,
  codexConfigRequestsFastTier,
  detectCodexFastTier,
} = await import(join(root, 'lib/providers/codex/speed.ts'));
const { parseDateLike, parseLocalDateOnly } = await import(join(root, 'lib/date-utils.ts'));
const { isUsageRange, normalizeUsageRange, rangeToDates } = await import(join(root, 'lib/range.ts'));

const fixture = join(root, 'lib/providers/codex/__fixtures__/sample.jsonl');
const parsed = await parseCodexJsonlFile(fixture);

console.log(`parsed: ${parsed.assistant.length} assistant, ${parsed.user.length} user, ${parsed.parentLinks.length} parentLinks`);

assert.equal(parsed.assistant.length, 3, 'should emit 3 AssistantRecords');
assert.equal(parsed.user.length, 1, 'should emit 1 UserRecord');

for (const r of parsed.assistant) assert.equal(r.source, 'codex');
assert.equal(parsed.user[0].source, 'codex');

const a = parsed.assistant;
const sumInput = a.reduce((s, r) => s + r.usage.input_tokens, 0);
const sumCacheRead = a.reduce((s, r) => s + r.usage.cache_read_input_tokens, 0);
const sumOutput = a.reduce((s, r) => s + r.usage.output_tokens, 0);
const sumReasoning = a.reduce((s, r) => s + (r.usage.reasoning_tokens ?? 0), 0);
assert.equal(sumInput, 1500, 'input_tokens after subtracting cached');
assert.equal(sumCacheRead, 2000, 'cached_input_tokens flows to cache_read');
assert.equal(sumOutput, 200, 'output_tokens = raw output only (reasoning already inside it, not re-added)');

assert.equal(sumReasoning, 60, 'reasoning_tokens (display-only) is present per record');
for (const rec of a) {
  if (rec.usage.reasoning_tokens && rec.usage.reasoning_tokens > 0) {
    assert.ok(
      rec.usage.output_tokens >= rec.usage.reasoning_tokens,
      `output_tokens (${rec.usage.output_tokens}) must include reasoning_tokens (${rec.usage.reasoning_tokens})`,
    );
  }
}

assert.equal(a[0].model, 'gpt-5');
assert.equal(a[1].model, 'gpt-5');
assert.equal(a[2].model, 'gpt-5-mini');
assert.equal(a[2].cwd, '/Users/test/proj-other', 'turn_context cwd switch');

assert.deepEqual(a[0].toolNames, ['shell_command']);
assert.equal(a[0].hasThinking, true);
assert.equal(a[0].textPreview, 'Looking at the code now');
assert.deepEqual(a[1].toolNames, ['apply_patch']);
assert.equal(a[1].hasThinking, false);
assert.equal(a[1].textPreview, '');

assert.equal(a[0].parentUuid, parsed.user[0].uuid);
assert.equal(a[1].parentUuid, parsed.user[0].uuid);
assert.equal(a[2].parentUuid, parsed.user[0].uuid);

assert.ok(a[0].requestId.startsWith('turn-1::'));
assert.ok(a[2].requestId.startsWith('turn-2::'));

const r = resolveCodexPricing('gpt-5');
assert.equal(r.matchType, 'exact');
const c = costFromUsage(
  {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation_5m: 0,
    cache_creation_1h: 0,
  },
  r.pricing,
);
assert.equal(c.total.toFixed(2), '11.25', 'gpt-5 cost: 1M input * 1.25 + 1M output * 10 (LiteLLM)');

assert.equal(shortenCodexModel('gpt-5'), 'GPT-5');
assert.equal(shortenCodexModel('gpt-5-mini'), 'GPT-5 Mini');
assert.equal(shortenCodexModel('gpt-5-nano'), 'GPT-5 Nano');

const r2 = resolveCodexPricing('gpt-7-future');
assert.equal(r2.matchType, 'family-fallback');
assert.ok(r2.pricing);

const r3 = resolveCodexPricing('o5-omega');
assert.equal(r3.matchType, 'family-fallback');
assert.ok(r3.pricing);

// Models the real Codex logs actually use must resolve EXACTLY — never fall
// back to the priciest gpt-5.5 tier. gpt-5.2 / gpt-5.2-codex bill at the codex
// tier (1.75/14); gpt-5.1 / gpt-5.1-codex at the base gpt-5 tier (1.25/10).
for (const m of ['gpt-5.2-codex', 'gpt-5.2']) {
  const rr = resolveCodexPricing(m);
  assert.equal(rr.matchType, 'exact', `${m} resolves exactly (not family-fallback)`);
  assert.equal(rr.pricing.input, 1.75, `${m} input = 1.75`);
  assert.equal(rr.pricing.output, 14, `${m} output = 14`);
}
for (const m of ['gpt-5.1', 'gpt-5.1-codex']) {
  const rr = resolveCodexPricing(m);
  assert.equal(rr.matchType, 'exact', `${m} resolves exactly (not family-fallback)`);
  assert.equal(rr.pricing.input, 1.25, `${m} input = 1.25`);
  assert.equal(rr.pricing.output, 10, `${m} output = 10`);
}

assert.ok('gpt-5' in BUILTIN_PRICING_OPENAI);
assert.ok('gpt-5-mini' in BUILTIN_PRICING_OPENAI);

assert.ok(parseLocalDateOnly('2026-02-28'), 'valid date-only should parse');
assert.equal(parseLocalDateOnly('2026-02-31'), null, 'overflow date-only should be rejected');
assert.equal(parseDateLike('2026-02-31T00:00:00Z'), null, 'overflow ISO timestamp should be rejected');
assert.ok(parseDateLike('2026-05-10T00:00:00Z'), 'valid ISO timestamp should parse');
assert.equal(isUsageRange('30d'), true);
assert.equal(isUsageRange('last_decade'), false);
assert.equal(normalizeUsageRange('last_decade', '7d'), '7d');
assert.ok(rangeToDates('7d').from instanceof Date);

{
  const dir = mkdtempSync(join(tmpdir(), 'ccgauge-codex-'));
  const mixFile = join(dir, 'mix-session.jsonl');
  const lines = [
    JSON.stringify({
      timestamp: '2026-05-01T10:00:00Z',
      type: 'session_meta',
      payload: { id: 'sess-mix', cwd: '/tmp/proj' },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T10:00:01Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-mix', cwd: '/tmp/proj', model: 'gpt-5' },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T10:00:02Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: 'hi',
      },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T10:00:03Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 30,
            reasoning_output_tokens: 5,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T10:00:04Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 30,
            reasoning_output_tokens: 5,
          },
        },
      },
    }),
  ];
  writeFileSync(mixFile, lines.join('\n') + '\n', 'utf8');
  const mixed = await parseCodexJsonlFile(mixFile);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(mixed.assistant.length, 1, 'refresh total after last must not emit again');
  const mixInput = mixed.assistant.reduce((s, r) => s + r.usage.input_tokens, 0);
  const mixOutput = mixed.assistant.reduce((s, r) => s + r.usage.output_tokens, 0);
  assert.equal(mixInput, 80, 'only the last_token_usage delta is counted');
  assert.equal(mixOutput, 30, 'only the last_token_usage delta is counted (output excludes re-added reasoning)');
  console.log('✓ last_token_usage → total_token_usage refresh does not double-count');
}

{
  const dir = mkdtempSync(join(tmpdir(), 'ccgauge-codex-'));
  const mixFile = join(dir, 'step-session.jsonl');
  const lines = [
    JSON.stringify({
      timestamp: '2026-05-01T11:00:00Z',
      type: 'session_meta',
      payload: { id: 'sess-step', cwd: '/tmp/proj' },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T11:00:01Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-step', cwd: '/tmp/proj', model: 'gpt-5' },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T11:00:02Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'hi' },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T11:00:03Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 0,
            output_tokens: 200,
            reasoning_output_tokens: 0,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T11:00:04Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 200,
            cached_input_tokens: 0,
            output_tokens: 50,
            reasoning_output_tokens: 0,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-05-01T11:00:05Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 1200,
            cached_input_tokens: 0,
            output_tokens: 250,
            reasoning_output_tokens: 0,
          },
        },
      },
    }),
  ];
  writeFileSync(mixFile, lines.join('\n') + '\n', 'utf8');
  const stepped = await parseCodexJsonlFile(mixFile);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(stepped.assistant.length, 2, 'total then last then total emits twice');
  const stepInput = stepped.assistant.reduce((s, r) => s + r.usage.input_tokens, 0);
  const stepOutput = stepped.assistant.reduce((s, r) => s + r.usage.output_tokens, 0);
  assert.equal(stepInput, 1200, '1000 from first total + 200 from last, not doubled');
  assert.equal(stepOutput, 250, '200 from first total + 50 from last, not doubled');
  console.log('✓ total → last → total counts each tranche once');
}

{
  // Codex >=0.146 runs subagents as FORKED threads. Each gets its own rollout
  // that (a) replays the parent's history verbatim and (b) keeps sampling the
  // parent's SHARED lineage token counter. Parsing them as independent sessions
  // billed the parent's whole history once per subagent.
  //
  // Measured on real ~/.codex data (2026-08-01, one user turn, 8 subagents):
  //   - every subagent file re-emitted the same two parent turns (19.97M / 1.73M)
  //   - 3 concurrent subagents claimed 8.54M of post-fork "own" delta while the
  //     shared counter only advanced 3.13M -> even post-fork deltas double-count
  //   - day total: 39.8M actual vs 265.7M parsed (6.7x)
  // So the whole file must go, not just its replayed prefix.
  const dir = mkdtempSync(join(tmpdir(), 'ccgauge-codex-fork-'));
  const tokenCount = (ts, input, output) =>
    JSON.stringify({
      timestamp: ts,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: 0,
            output_tokens: output,
            reasoning_output_tokens: 0,
          },
        },
      },
    });

  const forkMeta = {
    id: 'sub-thread-1',
    session_id: 'root-thread',
    forked_from_id: 'root-thread',
    parent_thread_id: 'root-thread',
    cwd: '/tmp/proj',
    thread_source: 'subagent',
    source: { subagent: { thread_spawn: { parent_thread_id: 'root-thread', depth: 1 } } },
  };
  const forkFile = join(dir, 'fork.jsonl');
  writeFileSync(
    forkFile,
    [
      JSON.stringify({ timestamp: '2026-08-01T06:07:20Z', type: 'session_meta', payload: forkMeta }),
      JSON.stringify({
        timestamp: '2026-08-01T06:07:20Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'replayed parent turn' },
      }),
      tokenCount('2026-08-01T06:07:20Z', 13_861_434, 62_397),
      tokenCount('2026-08-01T06:07:36Z', 21_759_038, 98_805),
    ].join('\n') + '\n',
    'utf8',
  );
  const fork = await parseCodexJsonlFile(forkFile);
  assert.equal(fork.assistant.length, 0, 'thread_spawn fork mirror emits no records');
  assert.equal(fork.user.length, 0, 'thread_spawn fork mirror emits no user records');
  assert.equal(fork.parentLinks.length, 0, 'thread_spawn fork mirror emits no parent links');

  // Guardian / auto-review subagents set NO forked_from_id and own an
  // independent counter starting near 0 -> genuine spend, must be kept.
  const guardianFile = join(dir, 'guardian.jsonl');
  writeFileSync(
    guardianFile,
    [
      JSON.stringify({
        timestamp: '2026-08-01T06:08:07Z',
        type: 'session_meta',
        payload: {
          id: 'guardian-1',
          session_id: 'root-thread',
          parent_thread_id: 'root-thread',
          cwd: '/tmp/proj',
          thread_source: 'subagent',
          source: { subagent: { other: 'guardian' } },
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:08:07Z',
        type: 'turn_context',
        payload: { turn_id: 'g-1', cwd: '/tmp/proj', model: 'codex-auto-review' },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:08:07Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'The following is the Codex agent history' },
      }),
      tokenCount('2026-08-01T06:08:10Z', 19_122, 258),
    ].join('\n') + '\n',
    'utf8',
  );
  const guardian = await parseCodexJsonlFile(guardianFile);
  assert.equal(guardian.assistant.length, 1, 'guardian subagent is real spend, not a mirror');
  assert.equal(guardian.assistant[0].model, 'codex-auto-review');

  // Older thread_spawn rollouts predate forked_from_id and had their own
  // counter — absence of the field must never be read as "mirror".
  const legacyFile = join(dir, 'legacy-spawn.jsonl');
  writeFileSync(
    legacyFile,
    [
      JSON.stringify({
        timestamp: '2026-07-22T10:04:49Z',
        type: 'session_meta',
        payload: {
          id: 'legacy-sub',
          parent_thread_id: 'root-old',
          cwd: '/tmp/proj',
          thread_source: 'subagent',
          source: { subagent: { thread_spawn: { parent_thread_id: 'root-old', depth: 1 } } },
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-22T10:04:50Z',
        type: 'turn_context',
        payload: { turn_id: 'l-1', cwd: '/tmp/proj', model: 'gpt-5' },
      }),
      JSON.stringify({
        timestamp: '2026-07-22T10:04:51Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'go' },
      }),
      tokenCount('2026-07-22T10:05:01Z', 24_797, 224),
    ].join('\n') + '\n',
    'utf8',
  );
  const legacy = await parseCodexJsonlFile(legacyFile);
  assert.equal(legacy.assistant.length, 1, 'legacy thread_spawn without forked_from_id is kept');

  rmSync(dir, { recursive: true, force: true });
  console.log('✓ subagent fork mirrors dropped; guardian + legacy spawns kept');
}

{
  // Two collateral bugs the fork rollouts exposed:
  //  1. replayed history re-emits the SOURCE session_meta mid-file — rebinding
  //     sessionId there stamped the file's tail with the parent's id.
  //  2. replayed history carries no turn_context, so records before the first
  //     one fell back to the 'gpt-unknown' placeholder. thread_settings_applied
  //     carries the real model and lands earlier in the file.
  const dir = mkdtempSync(join(tmpdir(), 'ccgauge-codex-meta-'));
  const file = join(dir, 'replayed-meta.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({
        timestamp: '2026-08-01T06:00:00Z',
        type: 'session_meta',
        payload: { id: 'own-thread', cwd: '/tmp/proj', cli_version: '0.146.0' },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:01Z',
        type: 'event_msg',
        payload: {
          type: 'thread_settings_applied',
          thread_settings: { model: 'gpt-5.6-sol', service_tier: 'priority' },
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:02Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'hello' },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:03Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 0,
              output_tokens: 100,
              reasoning_output_tokens: 0,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:04Z',
        type: 'session_meta',
        payload: { id: 'PARENT-thread', cwd: '/tmp/other', timestamp: '2026-08-01T03:00:00Z' },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:05Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 1500,
              cached_input_tokens: 0,
              output_tokens: 150,
              reasoning_output_tokens: 0,
            },
          },
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
  const parsedMeta = await parseCodexJsonlFile(file);
  rmSync(dir, { recursive: true, force: true });

  assert.equal(parsedMeta.assistant.length, 2);
  for (const rec of parsedMeta.assistant) {
    assert.equal(rec.sessionId, 'own-thread', 'a replayed session_meta must not rebind sessionId');
    assert.equal(rec.model, 'gpt-5.6-sol', 'thread_settings_applied supplies the model, not gpt-unknown');
    assert.equal(rec.cwd, '/tmp/proj', 'a replayed session_meta must not rebind cwd');
  }
  console.log('✓ replayed session_meta ignored; thread_settings_applied resolves the model');
}

{
  // `thread_settings_applied` is thread-level and fires BETWEEN turns, so it
  // can carry a default that disagrees with the turn actually running — 116 of
  // 477 such events disagree in real ~/.codex data. It must only fill in for
  // records that precede any turn_context, never override it: gpt-5.6-terra
  // billed as gpt-5.6-sol is a 2x error (input 2.5/output 15 vs 5/30).
  const dir = mkdtempSync(join(tmpdir(), 'ccgauge-codex-model-'));
  const file = join(dir, 'model-precedence.jsonl');
  const tc = (ts, input) =>
    JSON.stringify({
      timestamp: ts,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
          },
        },
      },
    });
  writeFileSync(
    file,
    [
      JSON.stringify({
        timestamp: '2026-07-20T09:00:00Z',
        type: 'session_meta',
        payload: { id: 'sess-prec', cwd: '/tmp/proj' },
      }),
      // Before any turn_context: the fallback is the only model source.
      JSON.stringify({
        timestamp: '2026-07-20T09:00:01Z',
        type: 'event_msg',
        payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-5.6-sol' } },
      }),
      JSON.stringify({
        timestamp: '2026-07-20T09:00:02Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'hi' },
      }),
      tc('2026-07-20T09:00:03Z', 1000),
      // turn_context speaks: it owns the model from here on.
      JSON.stringify({
        timestamp: '2026-07-20T09:00:04Z',
        type: 'turn_context',
        payload: { turn_id: 't-1', cwd: '/tmp/proj', model: 'gpt-5.6-terra', effort: 'high' },
      }),
      tc('2026-07-20T09:00:05Z', 2000),
      // A stale thread-level default lands mid-turn — must be ignored.
      JSON.stringify({
        timestamp: '2026-07-20T09:00:06Z',
        type: 'event_msg',
        payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-5.6-sol' } },
      }),
      tc('2026-07-20T09:00:07Z', 3000),
    ].join('\n') + '\n',
    'utf8',
  );
  const prec = await parseCodexJsonlFile(file);
  rmSync(dir, { recursive: true, force: true });

  assert.equal(prec.assistant.length, 3);
  assert.equal(prec.assistant[0].model, 'gpt-5.6-sol', 'pre-turn_context record uses the fallback');
  assert.equal(prec.assistant[1].model, 'gpt-5.6-terra', 'turn_context sets the model');
  assert.equal(
    prec.assistant[2].model,
    'gpt-5.6-terra',
    'a later thread_settings_applied must NOT override turn_context (2x pricing bug)',
  );
  console.log('✓ turn_context outranks thread_settings_applied; fallback only before it');
}

{
  // Two collateral bugs the fork rollouts exposed:
  //  1. replayed history re-emits the SOURCE session_meta mid-file — rebinding
  //     sessionId there stamped the file's tail with the parent's id.
  //  2. replayed history carries no turn_context, so records before the first
  //     one fell back to the 'gpt-unknown' placeholder. thread_settings_applied
  //     carries the real model and lands earlier in the file.
  const dir = mkdtempSync(join(tmpdir(), 'ccgauge-codex-meta-'));
  const file = join(dir, 'replayed-meta.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({
        timestamp: '2026-08-01T06:00:00Z',
        type: 'session_meta',
        payload: { id: 'own-thread', cwd: '/tmp/proj', cli_version: '0.146.0' },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:01Z',
        type: 'event_msg',
        payload: {
          type: 'thread_settings_applied',
          thread_settings: { model: 'gpt-5.6-sol', service_tier: 'priority' },
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:02Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'hello' },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:03Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 0,
              output_tokens: 100,
              reasoning_output_tokens: 0,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:04Z',
        type: 'session_meta',
        payload: { id: 'PARENT-thread', cwd: '/tmp/other', timestamp: '2026-08-01T03:00:00Z' },
      }),
      JSON.stringify({
        timestamp: '2026-08-01T06:00:05Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 1500,
              cached_input_tokens: 0,
              output_tokens: 150,
              reasoning_output_tokens: 0,
            },
          },
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
  const parsedMeta = await parseCodexJsonlFile(file);
  rmSync(dir, { recursive: true, force: true });

  assert.equal(parsedMeta.assistant.length, 2);
  for (const rec of parsedMeta.assistant) {
    assert.equal(rec.sessionId, 'own-thread', 'a replayed session_meta must not rebind sessionId');
    assert.equal(rec.model, 'gpt-5.6-sol', 'thread_settings_applied supplies the model, not gpt-unknown');
    assert.equal(rec.cwd, '/tmp/proj', 'a replayed session_meta must not rebind cwd');
  }
  console.log('✓ replayed session_meta ignored; thread_settings_applied resolves the model');
}

// --- ccusage parity: cost math (reasoning not billed) + fast/priority tier ---
{
  const codexPricing = resolveCodexPricing('gpt-5.3-codex').pricing;
  assert.ok(codexPricing, 'gpt-5.3-codex pricing present');
  // Same shape ccusage's snapshot exercises: 100 non-cached input + 110 cache
  // read + 15 output @ 1.75 / 0.175 / 14 per 1M → 0.00040425. reasoning(2) is a
  // subset of output and must not add to the bill.
  const usage = {
    input_tokens: 100,
    output_tokens: 15,
    cache_read_input_tokens: 110,
    cache_creation_input_tokens: 0,
    cache_creation_5m: 0,
    cache_creation_1h: 0,
    reasoning_tokens: 2,
  };
  const std = costFromUsage(usage, codexPricing);
  assert.equal(std.total.toFixed(8), '0.00040425', 'gpt-5.3-codex standard cost matches ccusage');
  const stdNoReasoning = costFromUsage({ ...usage, reasoning_tokens: 0 }, codexPricing);
  assert.equal(std.total, stdNoReasoning.total, 'reasoning_tokens never changes the cost');

  // gpt-5.3-codex fast multiplier is 2 → the whole cost doubles.
  const fast = costFromUsage(usage, scaleCodexPricing(codexPricing, 2));
  assert.equal(fast.total.toFixed(7), '0.0008085', 'gpt-5.3-codex fast (x2) matches ccusage snapshot');
  console.log('✓ codex cost parity with ccusage (standard + fast tier; reasoning not billed)');
}

{
  // Pure parser, ported from ccusage's `codex_config_requests_fast_service_tier`.
  assert.equal(codexConfigRequestsFastTier('service_tier = "fast"'), true, 'explicit fast');
  assert.equal(codexConfigRequestsFastTier("service_tier = 'priority' # use higher tier"), true, 'priority with comment');
  assert.equal(codexConfigRequestsFastTier('service_tier_override = "fast"'), false, 'override key must not match');
  assert.equal(codexConfigRequestsFastTier('service_tier = "breakfast"'), false, 'substring must not match');
  assert.equal(codexConfigRequestsFastTier('service_tier = "standard"'), false, 'standard is not fast');
  assert.equal(codexConfigRequestsFastTier('service_tier = "default"'), false, 'default is not fast');
  console.log('✓ service_tier parser matches ccusage (fast/priority only)');
}

{
  // detectCodexFastTier reads config.toml on EVERY call — no module-level cache.
  // Toggle the file mid-test and confirm the next call picks up the new value.
  // Override BOTH CODEX_HOME and HOME so the real ~/.codex/config.toml can't
  // shadow our tmp config (codexHomePaths() ORs the two sources).
  const rootDir = mkdtempSync(join(tmpdir(), 'ccgauge-codex-tier-'));
  const codexDir = join(rootDir, '.codex');
  (await import('node:fs')).mkdirSync(codexDir);
  const cfg = join(codexDir, 'config.toml');
  const prevCodexHome = process.env.CODEX_HOME;
  const prevHome = process.env.HOME;
  process.env.CODEX_HOME = codexDir;
  process.env.HOME = rootDir;
  try {
    writeFileSync(cfg, 'model = "gpt-5"\nservice_tier = "fast"\n', 'utf8');
    assert.equal(detectCodexFastTier(), true, 'reads fast from config.toml');
    writeFileSync(cfg, 'model = "gpt-5"\nservice_tier = "default"\n', 'utf8');
    assert.equal(detectCodexFastTier(), false, 'live re-reads after edit to default');
    writeFileSync(cfg, 'model = "gpt-5"\nservice_tier = "priority"\n', 'utf8');
    assert.equal(detectCodexFastTier(), true, 'live re-reads after edit to priority');
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(rootDir, { recursive: true, force: true });
  }
  console.log('✓ detectCodexFastTier has no boot cache (live config.toml reads)');
}

{
  // Per-model multipliers ported from ccusage's fast-multiplier-overrides.json.
  // Wire up a fast-tier CODEX_HOME *and* HOME so codexFastMultiplier returns > 1
  // even when the dev's real ~/.codex/config.toml says default.
  const rootDir = mkdtempSync(join(tmpdir(), 'ccgauge-codex-mult-'));
  const codexDir = join(rootDir, '.codex');
  (await import('node:fs')).mkdirSync(codexDir);
  writeFileSync(join(codexDir, 'config.toml'), 'model = "gpt-5"\nservice_tier = "fast"\n', 'utf8');
  const prevCodexHome = process.env.CODEX_HOME;
  const prevHome = process.env.HOME;
  process.env.CODEX_HOME = codexDir;
  process.env.HOME = rootDir;
  try {
    assert.equal(codexFastMultiplier('gpt-5.5'), 2.5, 'gpt-5.5 → 2.5');
    assert.equal(codexFastMultiplier('gpt-5.4'), 2, 'gpt-5.4 → 2');
    assert.equal(codexFastMultiplier('gpt-5.3-codex'), 2, 'gpt-5.3-codex → 2');
    assert.equal(codexFastMultiplier('gpt-5'), 2, 'unlisted model → default 2');
    assert.equal(codexFastMultiplier('openai/gpt-5.5-20260101'), 2.5, 'prefix/date normalized to gpt-5.5');
    // 1M output × $30/M × 2.5 = $75
    const p55 = resolveCodexPricing('gpt-5.5').pricing;
    const fast55 = costFromUsage(
      {
        input_tokens: 0,
        output_tokens: 1_000_000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation_5m: 0,
        cache_creation_1h: 0,
      },
      scaleCodexPricing(p55, codexFastMultiplier('gpt-5.5')),
    );
    assert.equal(fast55.total.toFixed(2), '75.00', 'gpt-5.5 fast: 1M output @ $30/M x2.5 = $75');
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(rootDir, { recursive: true, force: true });
  }
  console.log('✓ per-model fast multipliers gated by global service_tier=fast|priority');
}

console.log('\nAll codex parser + pricing assertions passed.');
