#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-refresh-'));
const home = join(dir, 'home');
const stateDir = join(dir, 'state');

process.env.HOME = home;
process.env.CCGAUGE_STATE_DIR = stateDir;
process.env.CCGAUGE_POLL_FALLBACK = '0';
for (const k of ['CLAUDE_CONFIG_DIR', 'CCGAUGE_CONFIG_DIR', 'CODEX_HOME', 'CCGAUGE_CODEX_DIR']) delete process.env[k];

function claudeTranscript(sessionId, model) {
  return [
    {
      type: 'user',
      uuid: `${sessionId}-u1`,
      parentUuid: null,
      timestamp: '2026-09-01T10:00:00.000Z',
      sessionId,
      cwd: '/tmp/proj',
      message: { role: 'user', content: 'hello' },
    },
    {
      type: 'assistant',
      uuid: `${sessionId}-a1`,
      parentUuid: `${sessionId}-u1`,
      timestamp: '2026-09-01T10:00:01.000Z',
      sessionId,
      cwd: '/tmp/proj',
      requestId: `${sessionId}-req`,
      message: {
        id: `${sessionId}-msg`,
        role: 'assistant',
        model,
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n') + '\n';
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const projectDir = join(home, '.claude', 'projects', 'proj');
  mkdirSync(projectDir, { recursive: true });
  const unchanged = join(projectDir, 'unchanged.jsonl');
  const changed = join(projectDir, 'changed.jsonl');
  writeFileSync(unchanged, claudeTranscript('s-unchanged', 'claude-sonnet-4-6'), 'utf8');
  writeFileSync(changed, claudeTranscript('s-changed', 'claude-sonnet-4-6'), 'utf8');

  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      "export { getIndexer } from '@/lib/data-loader/indexer';",
      "export { savePersistedIndex, loadPersistedIndex } from '@/lib/data-loader/index-persist';",
      "export { PROVIDERS } from '@/lib/providers';",
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
    external: ['fsevents'],
    logLevel: 'error',
  });
  const m = await import(pathToFileURL(outfile).href);
  const current = m.PROVIDERS.claude.parserVersion;

  function staleEntry(file, sessionId, { parserVersion, sizeDelta = 0 }) {
    const st = statSync(file);
    return {
      filePath: file,
      source: 'claude',
      parserVersion,
      mtimeMs: st.mtimeMs,
      size: st.size + sizeDelta,
      assistantRecords: [
        {
          type: 'assistant',
          source: 'claude',
          uuid: `${sessionId}-a1`,
          parentUuid: `${sessionId}-u1`,
          timestamp: '2026-09-01T10:00:01.000Z',
          sessionId,
          requestId: `${sessionId}-req`,
          cwd: '/tmp/proj',
          model: 'stale-model',
          messageId: `${sessionId}-msg`,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_5m: 0,
            cache_creation_1h: 0,
          },
          toolNames: [],
          hasThinking: false,
          textPreview: 'hi',
          filePath: file,
        },
      ],
      userRecords: [],
      parentLinks: [],
      spawnedSessions: [],
    };
  }

  {
    const name = 'refresh-upgrade';
    await m.savePersistedIndex(
      {
        savedAt: new Date().toISOString(),
        files: [
          staleEntry(unchanged, 's-unchanged', { parserVersion: 'claude-v0-old' }),
          staleEntry(changed, 's-changed', { parserVersion: 'claude-v0-old', sizeDelta: -1 }),
        ],
      },
      name,
    );
    const idx = m.getIndexer(name);
    await idx.init();

    const first = idx.getSnapshot();
    const modelOf = (snap, sid) => snap.records.find((r) => r.sessionId === sid)?.model;
    assert.equal(modelOf(first, 's-unchanged'), 'stale-model', 'an unchanged file with an outdated parser is served from the old cache first');
    assert.equal(modelOf(first, 's-changed'), 'claude-sonnet-4-6', 'a file that changed on disk is reparsed before the first snapshot');
    const busy = idx.getStatus();
    assert.equal(busy.progress.phase, 'refreshing', 'the outdated file is reparsed in the background');
    assert.equal(busy.progress.reason, 'upgrade', 'and the refresh is reported as a parser upgrade');
    assert.equal(busy.progress.filesTotal, 1, 'only the outdated, unchanged file is queued');
    assert.equal(busy.progress.bytesTotal, statSync(unchanged).size, 'its size is the refresh total');
    assert.equal(busy.isIndexing, true, 'status reports indexing while the refresh runs');

    const fresh = await idx.waitUntilFresh();
    assert.notEqual(fresh, first, 'the refresh publishes a new snapshot');
    assert.equal(modelOf(fresh, 's-unchanged'), 'claude-sonnet-4-6', 'and it carries the reparsed records');
    const done = idx.getStatus();
    assert.equal(done.progress.phase, 'idle');
    assert.equal(done.isIndexing, false);

    await delay(2500);
    const persisted = await m.loadPersistedIndex(name);
    const versions = persisted.files.map((f) => f.parserVersion);
    assert.deepEqual(versions, [current, current], 'the refreshed cache is persisted with the current parser version');
    idx.dispose();
    console.log('✓ outdated cache served first, refreshed in the background, then persisted');
  }

  {
    const name = 'refresh-waiter';
    await m.savePersistedIndex(
      {
        savedAt: new Date().toISOString(),
        files: [staleEntry(unchanged, 's-unchanged', { parserVersion: 'claude-v0-old' })],
      },
      name,
    );
    const idx = m.getIndexer(name);
    const snap = await idx.waitUntilFresh();
    assert.equal(
      snap.records.find((r) => r.sessionId === 's-unchanged')?.model,
      'claude-sonnet-4-6',
      'callers that need fresh data never see the outdated records',
    );
    idx.dispose();
    console.log('✓ waitUntilFresh skips the outdated snapshot');
  }

  {
    const name = 'refresh-current';
    await m.savePersistedIndex(
      {
        savedAt: new Date().toISOString(),
        files: [staleEntry(unchanged, 's-unchanged', { parserVersion: current })],
      },
      name,
    );
    const idx = m.getIndexer(name);
    await idx.init();
    assert.equal(idx.getStatus().progress.phase, 'idle', 'a current cache starts no refresh');
    assert.equal(
      idx.getSnapshot().records.find((r) => r.sessionId === 's-unchanged')?.model,
      'stale-model',
      'and is trusted as-is',
    );
    idx.dispose();
    console.log('✓ an up-to-date cache is used without a refresh');
  }

  {
    const coldDir = join(home, '.claude', 'projects', 'cold');
    mkdirSync(coldDir, { recursive: true });
    const older = join(coldDir, 'older.jsonl');
    writeFileSync(older, claudeTranscript('s-older', 'claude-opus-4-8'), 'utf8');
    const longAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    utimesSync(older, longAgo, longAgo);

    const name = 'refresh-cold';
    const idx = m.getIndexer(name);
    await idx.init();
    const first = idx.getSnapshot();
    const sessions = (snap) => new Set(snap.records.map((r) => r.sessionId));
    assert.ok(sessions(first).has('s-unchanged'), 'recently modified transcripts are parsed before the first snapshot');
    assert.ok(!sessions(first).has('s-older'), 'a transcript last modified before the recent window is left for later');
    const busy = idx.getStatus().progress;
    assert.equal(busy.phase, 'refreshing');
    assert.equal(busy.reason, 'backfill', 'the deferred history is reported as a backfill');
    assert.equal(busy.filesTotal, 1);
    assert.equal(busy.bytesTotal, statSync(older).size);

    const fresh = await idx.waitUntilFresh();
    assert.ok(sessions(fresh).has('s-older'), 'the backfill adds the older transcript');
    assert.equal(idx.getStatus().progress.phase, 'idle');

    await delay(2500);
    const persisted = await m.loadPersistedIndex(name);
    assert.ok(
      persisted.files.some((f) => f.filePath === older),
      'the backfilled transcript is persisted',
    );

    const rescanned = await idx.forceRescan();
    assert.ok(sessions(rescanned).has('s-older'), 'a manual rescan reads everything before returning');
    assert.equal(idx.getStatus().progress.phase, 'idle', 'and leaves nothing for the background');
    idx.dispose();
    console.log('✓ a cold index shows the recent window first and backfills older transcripts');
  }

  console.log('\nAll indexer-refresh assertions passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
