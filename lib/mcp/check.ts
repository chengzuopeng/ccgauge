import { getMcpIndexerReady } from './context';
import { ensurePricingLoaded } from '@/lib/pricing/store';

declare const __SERVER_VERSION__: string;
const SERVER_VERSION =
  typeof __SERVER_VERSION__ !== 'undefined' ? __SERVER_VERSION__ : 'dev';

export async function printCheck(): Promise<number> {
  ensurePricingLoaded();
  const out = (s: string) => process.stdout.write(`${s}\n`);
  out(`ccgauge MCP server v${SERVER_VERSION}`);
  out(`bundle:   OK`);
  try {
    const idx = await getMcpIndexerReady();
    const status = idx.getStatus();
    out(
      `indexer:  files=${status.filesIndexed} records=${status.recordsIndexed} ` +
        `loadedFromDisk=${status.loadedFromDisk}`,
    );
    if (status.bySource.length === 0) {
      out('providers: (none detected — no Claude Code or Codex data dirs found)');
    } else {
      out('providers:');
      for (const s of status.bySource) {
        out(
          `  ${s.source.padEnd(8)} ${String(s.filesScanned).padStart(4)} files  ` +
            `${String(s.assistantRecords).padStart(6)} records`,
        );
        if (s.scannedDirs.length > 0) {
          for (const dir of s.scannedDirs) out(`    ${dir}`);
        }
      }
    }
    if (status.errors && status.errors.length > 0) {
      out(`recent errors: ${status.errors.length}`);
      for (const e of status.errors.slice(-3)) out(`  - ${e}`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`[ccgauge-mcp] check failed: ${(err as Error).message}\n`);
    return 1;
  }
}
