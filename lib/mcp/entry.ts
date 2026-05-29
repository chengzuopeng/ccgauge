
import { fileURLToPath } from 'node:url';
import { runStdioServer } from './server';
import { printCheck } from './check';

export { runStdioServer, printCheck };

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  runStdioServer().catch((err) => {
    process.stderr.write(`[ccgauge-mcp] fatal: ${(err as Error).stack || err}\n`);
    process.exit(1);
  });
}
