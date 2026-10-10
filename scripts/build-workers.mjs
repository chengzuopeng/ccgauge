#!/usr/bin/env node
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'lib/data-loader/parse-worker.ts')],
  outfile: resolve(root, 'dist/workers/parse-worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  alias: {
    '@': root,
    '@/lib': resolve(root, 'lib'),
  },
  external: ['fsevents'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

console.log('[build-workers] dist/workers/parse-worker.mjs written');
