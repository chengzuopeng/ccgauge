import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerUsageTools } from './tools/usage';
import { registerActivityTools } from './tools/activity';
import { registerProvidersResource } from './resources/providers';
import { getMcpIndexerReady, MCP_INDEX_NAME } from './context';
import { getIndexer } from '@/lib/data-loader/indexer';
import { ensurePricingLoaded } from '@/lib/pricing/store';

const SERVER_NAME = 'ccgauge';
const SHUTDOWN_FLUSH_MS = 3_000;

declare const __SERVER_VERSION__: string;
const SERVER_VERSION =
  typeof __SERVER_VERSION__ !== 'undefined' ? __SERVER_VERSION__ : 'dev';

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  registerUsageTools(server);
  registerActivityTools(server);
  registerProvidersResource(server);

  return server;
}

export async function runStdioServer(): Promise<void> {
  ensurePricingLoaded();

  const log = (...args: unknown[]) => {
    process.stderr.write(`[ccgauge-mcp] ${args.map(String).join(' ')}\n`);
  };

  getMcpIndexerReady()
    .then((idx) => {
      const s = idx.getStatus();
      log(
        `indexer ready: files=${s.filesIndexed} records=${s.recordsIndexed} loadedFromDisk=${s.loadedFromDisk}`,
      );
    })
    .catch((err) => log('indexer init failed:', (err as Error).message));

  const server = createServer();
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = (reason: string) => {
    if (closing) return;
    closing = true;
    log(`shutting down (${reason})`);
    transport.close().catch(() => {});
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_FLUSH_MS));
    void Promise.race([getIndexer(MCP_INDEX_NAME).flushPersist(), deadline]).finally(() =>
      process.exit(0),
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await server.connect(transport);
  server.server.onclose = () => shutdown('transport closed');
  process.stdin.once('end', () => shutdown('stdin ended'));
  process.stdin.once('close', () => shutdown('stdin closed'));
  log(`v${SERVER_VERSION} listening on stdio`);
}
