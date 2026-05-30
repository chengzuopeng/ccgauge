#!/usr/bin/env node
/**
 * Post-build smoke gate for the pruned standalone server.
 *
 * Why this exists: `scripts/postbuild.mjs` aggressively prunes Next.js
 * internals (sharp, AMP validator, capsize font metrics, babel bundles,
 * `next/font` loaders) that ccgauge's configuration never loads. Those
 * removals are safe ONLY as long as our standing assumptions hold (no
 * `next/image` optimization, no AMP, no `next/font`). A Next version
 * bump could silently start requiring one of them at startup — and the
 * build would still succeed, shipping a package that crashes on every
 * user's machine.
 *
 * This script closes that gap: it boots the real pruned standalone
 * server and hits the key routes. If serving is broken, it exits non-
 * zero and FAILS THE BUILD — so a broken prune never reaches `npm
 * publish`. It runs as the last step of `package.json`'s `build`.
 *
 * It works with or without local Claude/Codex data: an empty scan just
 * renders the EmptyState (still HTTP 200), so it's CI-safe.
 */

import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import getPort from 'get-port';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(root, '.next', 'standalone');
const serverJs = join(standalone, 'server.js');

if (!existsSync(serverJs)) {
  console.error(`[smoke] standalone server.js not found at ${serverJs}`);
  console.error(`[smoke] did 'next build' + postbuild run?`);
  process.exit(1);
}

// Routes that exercise the prune-sensitive paths: each top-level page is
// a full RSC render (would 500 if a required Next internal was pruned),
// plus a couple of API routes and the middleware redirect.
const ROUTES = [
  { path: '/', expect: [200] },
  { path: '/usage', expect: [200] },
  { path: '/sessions', expect: [200] },
  { path: '/projects', expect: [200] },
  { path: '/models', expect: [200] },
  { path: '/settings', expect: [200] },
  { path: '/api/scan', expect: [200] },
  { path: '/api/pricing', expect: [200] },
  // Middleware-driven redirect (custom range w/o `from`).
  { path: '/usage?range=custom', expect: [307] },
];

const HOST = '127.0.0.1';
const PORT = await getPort({ port: [47119, 47120, 47121, 0] });
const READY_TIMEOUT_MS = 60_000;

const child = spawn(process.execPath, [serverJs], {
  cwd: standalone,
  env: { ...process.env, PORT: String(PORT), HOSTNAME: HOST, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout?.on('data', (d) => (serverLog += d));
child.stderr?.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode}) before becoming ready:\n${serverLog}`);
    }
    try {
      const res = await fetch(`http://${HOST}:${PORT}/api/scan`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`server did not become ready within ${READY_TIMEOUT_MS / 1000}s:\n${serverLog}`);
}

let failed = false;
try {
  console.log(`[smoke] booting pruned standalone on ${HOST}:${PORT} …`);
  await waitReady();
  for (const route of ROUTES) {
    let status = 0;
    try {
      const res = await fetch(`http://${HOST}:${PORT}${route.path}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
    } catch (err) {
      status = -1;
      serverLog += `\nfetch ${route.path} threw: ${err.message}`;
    }
    const ok = route.expect.includes(status);
    if (!ok) failed = true;
    console.log(`[smoke]   ${route.path.padEnd(24)} → ${status} ${ok ? '✓' : `✗ expected ${route.expect.join('/')}`}`);
  }
} catch (err) {
  failed = true;
  console.error(`[smoke] ${err.message}`);
} finally {
  child.kill('SIGTERM');
  await sleep(400);
  if (child.exitCode === null) child.kill('SIGKILL');
}

if (failed) {
  console.error('');
  console.error('[smoke] ✗ pruned standalone failed to serve — the build is BROKEN.');
  console.error('[smoke]   A pruned Next internal is likely still required at runtime.');
  console.error('[smoke]   Review scripts/postbuild.mjs `extraTargets` against the current Next version.');
  process.exit(1);
}
console.log('[smoke] ✓ pruned standalone serves all key routes');
