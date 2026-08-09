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
import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const stateDir = mkdtempSync(join(tmpdir(), 'ccgauge-persist-'));
process.env.CCGAUGE_STATE_DIR = stateDir;

const { savePersistedIndex, loadPersistedIndex } = await import(
  join(root, 'lib/data-loader/index-persist.ts')
);

const cacheDir = join(stateDir, 'cache');
mkdirSync(cacheDir, { recursive: true });
const indexName = 'index-v2.json';
const ls = () => readdirSync(cacheDir).sort();

const ageFile = (p, hoursAgo) => {
  const t = new Date(Date.now() - hoursAgo * 3600_000);
  utimesSync(p, t, t);
};

try {
  // An orphan from a long-dead process, plus one a concurrent writer just made.
  const stale = join(cacheDir, `${indexName}.tmp-99991`);
  const fresh = join(cacheDir, `${indexName}.tmp-99992`);
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

  await savePersistedIndex({ savedAt: new Date().toISOString(), files: [] });

  const after = ls();
  assert.ok(!after.includes(`${indexName}.tmp-99991`), 'a stale temp is swept');
  assert.ok(after.includes(`${indexName}.tmp-99992`), "a concurrent writer's fresh temp is left alone");
  assert.ok(!after.includes('index-mcp-v2.json.tmp-99994'), "another index's stale temp is swept too");
  assert.ok(after.includes('litellm-pricing.json'), 'unrelated files in the cache dir are untouched');
  assert.ok(after.includes(indexName), 'the index itself landed');
  console.log('✓ save sweeps stale temps, spares fresh ones and bystanders');

  // The index still round-trips after all that.
  const loaded = await loadPersistedIndex();
  assert.ok(loaded && Array.isArray(loaded.files), 'the saved index reads back');
  console.log('✓ index round-trips through save/load');

  // Startup sweeps too, so orphans from a previous run go even if we never save.
  const stale2 = join(cacheDir, `${indexName}.tmp-99993`);
  writeFileSync(stale2, 'x', 'utf8');
  ageFile(stale2, 5);
  await loadPersistedIndex();
  await new Promise((r) => setTimeout(r, 50)); // the load-time sweep is fire-and-forget
  assert.ok(!ls().includes(`${indexName}.tmp-99993`), 'load sweeps stale temps as well');
  console.log('✓ load sweeps what a previous run left behind');

  // A write that blows up must not leave its own temp behind. Circular payload
  // → JSON.stringify throws after the temp path is chosen.
  const circular = {};
  circular.self = circular;
  await assert.rejects(
    savePersistedIndex({ savedAt: 'x', files: circular }),
    'a failing write propagates its error',
  );
  assert.ok(
    !ls().some((n) => n === `${indexName}.tmp-${process.pid}`),
    'a failed write does not become one more orphan',
  );
  console.log('✓ a failed write cleans up its own temp');
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}

console.log('\nAll index-persist assertions passed.');
