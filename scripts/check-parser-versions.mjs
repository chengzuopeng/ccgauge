#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function loadBaseline() {
  const path = resolve(here, 'parser-versions.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readParserVersionFromAdapter(adapterFile) {
  const src = readFileSync(adapterFile, 'utf8');
  const m = src.match(/parserVersion:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error(`no parserVersion literal found in ${adapterFile}`);
  return m[1];
}

const baseline = loadBaseline();
const adapters = [
  { id: 'claude', file: resolve(repoRoot, 'lib/providers/claude/index.ts') },
  { id: 'codex', file: resolve(repoRoot, 'lib/providers/codex/index.ts') },
];

let failed = false;
for (const { id, file } of adapters) {
  const actual = readParserVersionFromAdapter(file);
  const expected = baseline[id];
  if (!expected) {
    console.error(`✘ ${id}: no baseline entry in scripts/parser-versions.json`);
    failed = true;
    continue;
  }
  if (actual !== expected) {
    console.error(
      `✘ ${id}: parserVersion drift\n` +
        `   adapter:  ${actual}\n` +
        `   baseline: ${expected}\n` +
        `   → If you intentionally bumped the parser, update scripts/parser-versions.json.\n` +
        `   → If you didn't, restore the previous parserVersion in lib/providers/${id}/index.ts.`,
    );
    failed = true;
  } else {
    console.log(`✓ ${id}: parserVersion=${actual}`);
  }
}

if (failed) {
  console.error('\nparser-versions check FAILED.');
  process.exit(1);
}
console.log('\nAll parser versions match the baseline.');
