#!/usr/bin/env node

import { promises as fs, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const standalone = join(root, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.error(`[postbuild] standalone dir not found: ${standalone}`);
  console.error(`[postbuild] did 'next build' run successfully?`);
  process.exit(1);
}

await copyDir(join(root, '.next', 'static'), join(standalone, '.next', 'static'));

const publicDir = join(root, 'public');
if (existsSync(publicDir)) {
  await copyDir(publicDir, join(standalone, 'public'));
}
console.log('[postbuild] copied static assets into .next/standalone');

const pruned = await pruneStandalone(standalone);
if (pruned.entries.length) {
  console.log(
    `[postbuild] pruned ${pruned.entries.length} unused dependency dir(s) ` +
      `(~${(pruned.bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  for (const e of pruned.entries) console.log(`  - ${e}`);
}

const materialized = await materializeSymlinks(join(standalone, 'node_modules'));
if (materialized.length) {
  console.log(`[postbuild] materialized ${materialized.length} pnpm symlink(s) → real dirs`);
  for (const m of materialized) console.log(`  - ${m}`);
}

// Second prune pass — runs AFTER materialize so everything is a real dir.
// Next's file tracer copies sharp's platform binary as REAL files into a
// NESTED `next/node_modules/@img` (macOS libvips, ~16 MB) that the
// top-level + .pnpm sweep above never reaches. ccgauge sets
// `images: { unoptimized: true }` and uses no `next/image`, so sharp is
// pure dead weight. This recursive sweep walks ONLY node_modules trees
// (never the multi-MB `next/dist`) and removes the targets wherever they
// nest. Also drops the AMP validator wasm (~3.8 MB) — ccgauge renders no
// AMP pages, and Next only lazy-requires it for AMP output.
const nestedPruned = await pruneModulesTree(
  join(standalone, 'node_modules'),
  new Set(['@img', 'sharp', 'typescript']),
);

// Targeted removal of Next internals that ccgauge's configuration never
// loads. Each is gated on a STANDING ASSUMPTION about how we use Next —
// if any of these assumptions ever changes, the matching entry MUST be
// removed from this list or the published package breaks at runtime.
//
// A `scripts/smoke-standalone.mjs` step runs right after this in the
// build chain: it boots the pruned standalone and hits the key routes,
// failing the build if any of these removals broke serving. That smoke
// gate is what makes pruning Next internals safe — without it, a Next
// upgrade could silently start requiring one of these and ship a broken
// package. Do NOT remove the smoke step from `package.json`'s build.
const NEXT_DIST = join(standalone, 'node_modules', 'next', 'dist');
const extraTargets = [
  // AMP validator wasm — ccgauge renders no AMP pages.
  { path: join(NEXT_DIST, 'compiled', 'amphtml-validator'), label: 'next/dist/compiled/amphtml-validator' },
  // Font fallback metrics — only read by `next/font` (via font-utils.js,
  // which is NOT in the base-server startup chain). We self-host fonts
  // via @fontsource/geist and use no `next/font`.
  { path: join(NEXT_DIST, 'server', 'capsize-font-metrics.json'), label: 'next/dist/server/capsize-font-metrics.json' },
  // Babel transpiler bundles — App Router production runs on SWC; babel
  // here is only used by `next/font` loaders / legacy transforms.
  { path: join(NEXT_DIST, 'compiled', 'babel'), label: 'next/dist/compiled/babel' },
  { path: join(NEXT_DIST, 'compiled', 'babel-packages'), label: 'next/dist/compiled/babel-packages' },
  // `next/font` implementation — unused (see above).
  { path: join(NEXT_DIST, 'compiled', '@next', 'font'), label: 'next/dist/compiled/@next/font' },
];
for (const { path: target, label } of extraTargets) {
  try {
    await fs.lstat(target);
    nestedPruned.bytes += await entrySize(target);
    await fs.rm(target, { recursive: true, force: true });
    nestedPruned.entries.push(label);
  } catch {
    // not present — fine
  }
}
if (nestedPruned.entries.length) {
  console.log(
    `[postbuild] pruned ${nestedPruned.entries.length} nested dir(s) ` +
      `(~${(nestedPruned.bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  for (const e of nestedPruned.entries) console.log(`  - ${e}`);
}

async function materializeSymlinks(nm) {
  if (!existsSync(nm)) return [];
  const out = [];
  await walk(nm);
  return out;

  async function walk(dir, prefix = '') {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.pnpm' || e.name === '.bin') continue;
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) {
        let real;
        try {
          real = await fs.realpath(p);
        } catch {

          await fs.rm(p, { force: true });
          continue;
        }
        await fs.rm(p, { force: true });
        await copyDir(real, p);
        out.push(`${prefix}${e.name}`);
      } else if (e.isDirectory() && e.name.startsWith('@')) {

        await walk(p, `${e.name}/`);
      }
    }
  }
}

async function pruneStandalone(standaloneDir) {

  const PRUNE_TOP_LEVEL = ['typescript', 'sharp', '@img'];

  const PRUNE_PNPM = [
    /^@img\+/,
    /^sharp@/,
    /^typescript@/,
  ];

  const result = { entries: [], bytes: 0 };
  const nm = join(standaloneDir, 'node_modules');
  if (!existsSync(nm)) return result;

  for (const name of PRUNE_TOP_LEVEL) {
    const p = join(nm, name);
    try {
      await fs.lstat(p);
      result.bytes += await dirSize(p);
      await fs.rm(p, { recursive: true, force: true });
      result.entries.push(name);
    } catch {

    }
  }

  const pnpm = join(nm, '.pnpm');
  if (existsSync(pnpm)) {
    for (const e of await fs.readdir(pnpm, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (!PRUNE_PNPM.some((re) => re.test(e.name))) continue;
      const target = join(pnpm, e.name);
      result.bytes += await dirSize(target);
      await fs.rm(target, { recursive: true, force: true });
      result.entries.push(`.pnpm/${e.name}`);
    }
  }

  return result;
}

/**
 * Recursively delete every directory whose basename is in `names`,
 * traversing ONLY node_modules trees (top-level packages, their `@scope`
 * subdirs, and any nested `<pkg>/node_modules`). Never descends into
 * package source like `next/dist`, so it's fast even on a large tree.
 */
async function pruneModulesTree(nm, names, prefix = '') {
  const result = { entries: [], bytes: 0 };
  let entries;
  try {
    entries = await fs.readdir(nm, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = join(nm, e.name);
    if (names.has(e.name)) {
      result.bytes += await dirSize(p);
      await fs.rm(p, { recursive: true, force: true });
      result.entries.push(`${prefix}${e.name}`);
      continue;
    }
    if (e.name === '.pnpm' || e.name === '.bin') continue;
    // `@scope` dir — recurse to reach `@scope/<target>`.
    if (e.name.startsWith('@')) {
      const sub = await pruneModulesTree(p, names, `${prefix}${e.name}/`);
      result.entries.push(...sub.entries);
      result.bytes += sub.bytes;
      continue;
    }
    // A package — descend only into its own nested node_modules, if any.
    const innerNm = join(p, 'node_modules');
    if (existsSync(innerNm)) {
      const sub = await pruneModulesTree(innerNm, names, `${prefix}${e.name}/node_modules/`);
      result.entries.push(...sub.entries);
      result.bytes += sub.bytes;
    }
  }
  return result;
}

/** Size of a path whether it's a single file or a directory tree. */
async function entrySize(p) {
  const st = await fs.stat(p);
  return st.isDirectory() ? dirSize(p) : st.size;
}

async function dirSize(dir) {
  let total = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        total += await dirSize(p);
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(p);
          total += st.size;
        } catch {

        }
      }
    }
  } catch {

  }
  return total;
}

async function copyDir(src, dst) {
  if (!existsSync(src)) return;
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const sp = join(src, e.name);
    const dp = join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(sp, dp);
    } else if (e.isFile()) {
      await fs.copyFile(sp, dp);
    }
  }
}
