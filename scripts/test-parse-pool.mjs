#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-parse-pool-'));

function claudeLines() {
  return [
    { type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-09-01T10:00:00.000Z', sessionId: 's1', cwd: '/tmp/p', message: { role: 'user', content: 'hello' } },
    {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      timestamp: '2026-09-01T10:00:01.000Z',
      sessionId: 's1',
      cwd: '/tmp/p',
      requestId: 'req-1',
      message: {
        id: 'msg-1',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    },
    {
      type: 'user',
      uuid: 'u2',
      parentUuid: 'a1',
      timestamp: '2026-09-01T10:00:02.000Z',
      sessionId: 's1',
      cwd: '/tmp/p',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: [{ type: 'image', source: { type: 'base64', data: 'QUJD' } }] }] },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n') + '\n';
}

function codexLines() {
  return [
    { timestamp: '2026-09-01T11:00:00Z', type: 'session_meta', payload: { id: 'c1', cwd: '/tmp/p', cli_version: '0.147.0' } },
    { timestamp: '2026-09-01T11:00:01Z', type: 'turn_context', payload: { turn_id: 't1', cwd: '/tmp/p', model: 'llm-gateway--gpt-5.5' } },
    { timestamp: '2026-09-01T11:00:02Z', type: 'event_msg', payload: { type: 'user_message', message: 'hi' } },
    { timestamp: '2026-09-01T11:00:03Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } } } },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n') + '\n';
}

try {
  const claudeFile = join(dir, 'claude.jsonl');
  const codexFile = join(dir, 'codex.jsonl');
  writeFileSync(claudeFile, claudeLines(), 'utf8');
  writeFileSync(codexFile, codexLines(), 'utf8');

  const workerFile = join(dir, 'parse-worker.mjs');
  await build({
    entryPoints: [join(root, 'lib/data-loader/parse-worker.ts')],
    outfile: workerFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    alias: { '@': root },
    logLevel: 'error',
  });
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    "export { parseTranscript } from '@/lib/data-loader/parse-pool';\nexport { PROVIDERS } from '@/lib/providers';\n",
  );
  const bundle = join(dir, 'bundle.mjs');
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node20', alias: { '@': root }, logLevel: 'error' });

  process.env.CCGAUGE_PARSE_WORKER = workerFile;
  process.env.CCGAUGE_PARSE_WORKERS = '2';
  const m = await import(pathToFileURL(bundle).href);

  for (const [source, file] of [['claude', claudeFile], ['codex', codexFile]]) {
    const provider = m.PROVIDERS[source];
    const inThread = await provider.parseFile(file);
    const viaWorker = await m.parseTranscript(provider, file);
    assert.ok(inThread.assistant.length > 0, `${source} fixture yields records`);
    assert.ok(isDeepStrictEqual(viaWorker, inThread), `${source}: a worker parse equals the in-thread parse, undefined fields included`);
  }
  const many = await Promise.all(
    Array.from({ length: 12 }, (_, i) => m.parseTranscript(m.PROVIDERS.codex, codexFile).then((r) => [i, r])),
  );
  assert.equal(many.length, 12, 'more tasks than workers are queued and all complete');
  await assert.rejects(
    m.parseTranscript(m.PROVIDERS.claude, join(dir, 'missing.jsonl')),
    /ENOENT/,
    'a parse error surfaces exactly as it would in-thread',
  );
  console.log('✓ worker parses equal in-thread parses; queueing and errors behave the same');

  const probe = join(dir, 'probe.mjs');
  writeFileSync(
    probe,
    [
      `const m = await import(${JSON.stringify(pathToFileURL(bundle).href)});`,
      `const r = await m.parseTranscript(m.PROVIDERS.codex, ${JSON.stringify(codexFile)});`,
      'console.log(r.assistant.length);',
    ].join('\n'),
  );
  const env = { ...process.env, CCGAUGE_PARSE_WORKER: workerFile, CCGAUGE_PARSE_WORKERS: '2' };
  const started = Date.now();
  const run = spawnSync(process.execPath, [probe], { env, encoding: 'utf8', timeout: 8000 });
  assert.equal(run.status, 0, `the probe exits cleanly (${run.stderr})`);
  assert.equal(run.stdout.trim(), '1');
  assert.ok(Date.now() - started < 5000, 'idle workers never keep the process alive');

  const broken = spawnSync(process.execPath, [probe], {
    env: { ...env, CCGAUGE_PARSE_WORKER: join(dir, 'no-such-worker.mjs') },
    encoding: 'utf8',
    timeout: 8000,
  });
  assert.equal(broken.status, 0, `a missing worker script falls back to in-thread parsing (${broken.stderr})`);
  assert.equal(broken.stdout.trim(), '1');
  console.log('✓ idle workers let the process exit; a missing worker script falls back in-thread');

  console.log('\nAll parse-pool assertions passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
