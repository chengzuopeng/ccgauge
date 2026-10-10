#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * Regression tests for the persisted index's temp-file discipline.
 *
 * `savePersistedIndex` writes `<index>.tmp-<pid>` then renames it into place.
 * Nothing ever collected the ones left behind by a process that died in
 * between: 125 orphans totalling 2.2GB had accumulated over three months on
 * one machine. These lock in that they get swept, that a fresh temp from a
 * concurrent writer does NOT, and that a failed write cleans up after itself.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  utimesSync,
  statSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const stateDir = mkdtempSync(join(tmpdir(), 'ccgauge-persist-'));
process.env.CCGAUGE_STATE_DIR = stateDir;

const { savePersistedIndex, loadPersistedIndex, shardOf } = await import(
  join(root, 'lib/data-loader/index-persist.ts')
);

const cacheDir = join(stateDir, 'cache');
const shardDir = join(cacheDir, 'index-v3');
mkdirSync(cacheDir, { recursive: true });
const legacyName = 'index-v2.json';
const ls = (dir = cacheDir) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const shardName = (path) => `shard-${shardOf(path).toString(16).padStart(2, '0')}.json`;

const ageFile = (p, hoursAgo) => {
  const t = new Date(Date.now() - hoursAgo * 3600_000);
  utimesSync(p, t, t);
};

function entry(filePath, model = 'claude-sonnet-4-6') {
  return {
    filePath,
    source: 'claude',
    parserVersion: 'claude-test',
    mtimeMs: 1,
    size: 2,
    assistantRecords: [
      {
        type: 'assistant',
        source: 'claude',
        uuid: `${filePath}-a`,
        parentUuid: null,
        timestamp: '2026-09-01T00:00:00.000Z',
        sessionId: 's',
        requestId: 'r',
        cwd: '/tmp',
        model,
        messageId: `${filePath}-m`,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_5m: 0,
          cache_creation_1h: 0,
        },
        toolNames: [],
        hasThinking: false,
        textPreview: '',
        filePath,
      },
    ],
    userRecords: [
      {
        type: 'user',
        source: 'claude',
        uuid: `${filePath}-u`,
        parentUuid: null,
        timestamp: '2026-09-01T00:00:00.000Z',
        sessionId: 's',
        cwd: '/tmp',
        textPreview: 'hi',
        filePath,
      },
    ],
    parentLinks: [[`${filePath}-u`, null]],
    spawnedSessions: [],
  };
}

const paths = Array.from({ length: 40 }, (_, i) => `/data/projects/p${i}/session-${i}.jsonl`);
const shardsUsed = new Set(paths.map(shardOf));
const byPath = (files) => new Map(files.map((f) => [f.filePath, f]));

try {
  // An orphan from a long-dead process, plus one a concurrent writer just made.
  const stale = join(cacheDir, `${legacyName}.tmp-99991`);
  const fresh = join(cacheDir, `${legacyName}.tmp-99992`);
  writeFileSync(stale, 'x', 'utf8');
  writeFileSync(fresh, 'x', 'utf8');
  ageFile(stale, 3);

  // An unrelated file that merely shares the directory must survive.
  const bystander = join(cacheDir, 'litellm-pricing.json');
  writeFileSync(bystander, '{}', 'utf8');
  ageFile(bystander, 99);

  // Another index's orphan (the MCP server's) must be collected too — each
  // index used to clean only its own, and those were the bulk of the leak.
  const otherIndex = join(cacheDir, 'index-mcp-v2.json.tmp-99994');
  writeFileSync(otherIndex, 'x', 'utf8');
  ageFile(otherIndex, 8);

  mkdirSync(shardDir, { recursive: true });
  const staleShardTemp = join(shardDir, 'shard-00.json.tmp-99995');
  writeFileSync(staleShardTemp, 'x', 'utf8');
  ageFile(staleShardTemp, 4);

  await savePersistedIndex({ savedAt: '2026-09-01T00:00:00.000Z', files: paths.map((p) => entry(p)) });

  const after = ls();
  assert.ok(!after.includes(`${legacyName}.tmp-99991`), 'a stale temp is swept');
  assert.ok(after.includes(`${legacyName}.tmp-99992`), "a concurrent writer's fresh temp is left alone");
  assert.ok(!after.includes('index-mcp-v2.json.tmp-99994'), "another index's stale temp is swept too");
  assert.ok(after.includes('litellm-pricing.json'), 'unrelated files in the cache dir are untouched');
  assert.ok(!ls(shardDir).includes('shard-00.json.tmp-99995'), 'a stale shard temp is swept');
  assert.equal(
    ls(shardDir).filter((n) => n.endsWith('.json')).length,
    shardsUsed.size,
    'one shard file per bucket that holds an entry',
  );
  console.log('✓ save sweeps stale temps, spares fresh ones and bystanders');

  const loaded = await loadPersistedIndex();
  assert.equal(loaded.files.length, paths.length, 'every entry reads back');
  for (const f of loaded.files) {
    assert.equal(f.assistantRecords[0].filePath, f.filePath, 'record file paths are restored on load');
    assert.equal(f.userRecords[0].filePath, f.filePath);
  }
  const onDisk = readFileSync(join(shardDir, shardName(paths[0])), 'utf8');
  assert.equal((onDisk.match(/"filePath"/g) ?? []).length, JSON.parse(onDisk).files.length, 'only entries store their path on disk');
  console.log('✓ index round-trips through save/load without per-record paths on disk');

  const target = paths[3];
  const untouched = paths.find((p) => shardOf(p) !== shardOf(target));
  const untouchedFile = join(shardDir, shardName(untouched));
  const targetFile = join(shardDir, shardName(target));
  ageFile(untouchedFile, 1);
  ageFile(targetFile, 1);
  const untouchedBefore = statSync(untouchedFile).mtimeMs;
  const targetBefore = statSync(targetFile).mtimeMs;
  const updated = paths.map((p) => (p === target ? entry(p, 'claude-opus-4-8') : entry(p)));
  await savePersistedIndex({ savedAt: '2026-09-02T00:00:00.000Z', files: updated }, undefined, { dirtyPaths: [target] });
  assert.equal(statSync(untouchedFile).mtimeMs, untouchedBefore, 'a shard without changes is not rewritten');
  assert.notEqual(statSync(targetFile).mtimeMs, targetBefore, 'the changed shard is rewritten');
  const reread = byPath((await loadPersistedIndex()).files);
  assert.equal(reread.get(target).assistantRecords[0].model, 'claude-opus-4-8', 'and carries the change');
  assert.equal((await loadPersistedIndex()).savedAt, '2026-09-02T00:00:00.000Z', 'savedAt is the newest shard');

  const remaining = updated.filter((f) => f.filePath !== target);
  await savePersistedIndex({ savedAt: '2026-09-03T00:00:00.000Z', files: remaining }, undefined, { dirtyPaths: [target] });
  assert.ok(!byPath((await loadPersistedIndex()).files).has(target), 'an entry removed from a dirty shard is gone');
  console.log('✓ only shards holding changed transcripts are rewritten');

  writeFileSync(join(shardDir, shardName(untouched)), '{not json', 'utf8');
  const partial = await loadPersistedIndex();
  assert.ok(!byPath(partial.files).has(untouched), 'a corrupt shard is skipped');
  assert.ok(partial.files.length > 0, 'while the other shards still load');
  console.log('✓ a corrupt shard costs only its own entries');

  // Startup sweeps too, so orphans from a previous run go even if we never save.
  const stale2 = join(shardDir, 'shard-01.json.tmp-99993');
  writeFileSync(stale2, 'x', 'utf8');
  ageFile(stale2, 5);
  await loadPersistedIndex();
  await new Promise((r) => setTimeout(r, 50)); // the load-time sweep is fire-and-forget
  assert.ok(!ls(shardDir).includes('shard-01.json.tmp-99993'), 'load sweeps stale temps as well');
  console.log('✓ load sweeps what a previous run left behind');

  // A write that blows up must not leave its own temp behind. Circular payload
  // → JSON.stringify throws after the temp path is chosen.
  const circular = entry('/data/projects/circular.jsonl');
  circular.assistantRecords[0].self = circular.assistantRecords[0];
  await assert.rejects(
    savePersistedIndex({ savedAt: 'x', files: [circular] }, undefined, { dirtyPaths: [circular.filePath] }),
    'a failing write propagates its error',
  );
  assert.ok(
    !ls(shardDir).some((n) => n.endsWith(`.tmp-${process.pid}`)),
    'a failed write does not become one more orphan',
  );
  console.log('✓ a failed write cleans up its own temp');

  rmSync(shardDir, { recursive: true, force: true });
  const legacyFiles = paths.slice(0, 5).map((p) => entry(p));
  writeFileSync(
    join(cacheDir, legacyName),
    JSON.stringify({ schemaVersion: 2, savedAt: '2026-08-01T00:00:00.000Z', files: legacyFiles }),
    'utf8',
  );
  const legacy = await loadPersistedIndex();
  assert.equal(legacy.legacy, true, 'with no shards, the previous single-file index is read');
  assert.equal(legacy.files.length, 5);
  assert.equal(legacy.files[0].assistantRecords[0].filePath, legacy.files[0].filePath);
  await savePersistedIndex({ savedAt: '2026-09-04T00:00:00.000Z', files: legacy.files });
  assert.ok(!ls().includes(legacyName), 'a full save replaces the previous index file');
  const migrated = await loadPersistedIndex();
  assert.equal(migrated.legacy, undefined);
  assert.equal(migrated.files.length, 5, 'its entries now live in shards');
  console.log('✓ the previous single-file index migrates into shards');
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}

console.log('\nAll index-persist assertions passed.');
