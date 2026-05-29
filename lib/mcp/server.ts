import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerUsageTools } from './tools/usage';
import { registerActivityTools } from './tools/activity';
import { registerProvidersResource } from './resources/providers';
import { getMcpIndexerReady } from './context';

const SERVER_NAME = 'ccgauge';

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

  const shutdown = () => {
    log('shutting down');
    transport.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
  log(`v${SERVER_VERSION} listening on stdio`);
}
