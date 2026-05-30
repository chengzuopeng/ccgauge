#!/usr/bin/env node
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

await build({
  entryPoints: [resolve(root, 'lib/cli-report/index.ts')],
  outfile: resolve(root, 'dist/report/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  alias: {
    '@': root,
    '@/lib': resolve(root, 'lib'),
  },
  external: [],
  sourcemap: false,
  // Minify — same as the MCP bundle. The dashboard pulls in boxen /
  // cli-table3 / chalk, so the un-minified bundle is ~307 KB; minified
  // it's ~166 KB. The output is consumed only by `node`, never read by
  // a human, so there's no debuggability cost.
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

console.log('[build-report] dist/report/index.mjs written');
