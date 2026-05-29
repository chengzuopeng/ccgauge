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
assert.equal(sumOutput, 260, 'output + reasoning merged into output_tokens');

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
assert.equal(c.total.toFixed(2), '11.25', 'gpt-5 cost: 1M input * 1.25 + 1M output * 10');

assert.equal(shortenCodexModel('gpt-5'), 'GPT-5');
assert.equal(shortenCodexModel('gpt-5-mini'), 'GPT-5 Mini');
assert.equal(shortenCodexModel('gpt-5-nano'), 'GPT-5 Nano');

const r2 = resolveCodexPricing('gpt-7-future');
assert.equal(r2.matchType, 'family-fallback');
assert.ok(r2.pricing);

const r3 = resolveCodexPricing('o5-omega');
assert.equal(r3.matchType, 'family-fallback');
assert.ok(r3.pricing);

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
  assert.equal(mixOutput, 35, 'only the last_token_usage delta is counted');
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

console.log('\nAll codex parser + pricing assertions passed.');
