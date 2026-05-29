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
