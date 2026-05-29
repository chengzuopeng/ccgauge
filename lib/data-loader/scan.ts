import { listProviders } from '../providers';
import type { ProviderId } from '../providers';
import type { ScanResult, ScanStatsBySource } from '../types';
import { getIndexer, type IndexerStatus } from './indexer';

export interface ScanResultExtended extends ScanResult {
  bySource: ScanStatsBySource[];
}

export async function getCachedScan(opts: { force?: boolean } = {}): Promise<ScanResultExtended> {
  const idx = getIndexer();
  if (opts.force) {
    return idx.forceRescan();
  }
  await idx.init();
  return idx.getSnapshot();
}

export async function scanAll(opts: { force?: boolean } = {}): Promise<ScanResultExtended> {
  return getCachedScan(opts);
}

export function clearScanCache() {

}

export function getScannedDirs(): string[] {
  const out: string[] = [];
  for (const p of listProviders()) {
    out.push(...p.getDirs());
  }
  return Array.from(new Set(out));
}

export function getScannedDirsBySource(): Array<{ source: ProviderId; dirs: string[] }> {
  return listProviders().map((p) => ({ source: p.id, dirs: p.getDirs() }));
}

export function getIndexerStatus(): IndexerStatus {
  return getIndexer().getStatus();
}
