#!/usr/bin/env node
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

await build({
  entryPoints: [resolve(root, 'lib/mcp/entry.ts')],
  outfile: resolve(root, 'dist/mcp/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',

  alias: {
    '@': root,
    '@/lib': resolve(root, 'lib'),
  },

  external: ['fsevents'],
  define: {
    __SERVER_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },

  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});

console.log(`[build-mcp] dist/mcp/server.mjs written (v${pkg.version})`);
