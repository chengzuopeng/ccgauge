import { promises as fs, watch as fsWatch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dedupAssistantRecords } from '../dedup';
import { listProviders } from '../providers';
import type { ProviderAdapter, ProviderId } from '../providers';
import type {
  AssistantRecord,
  ScanResult,
  ScanStats,
  ScanStatsBySource,
  UserRecord,
} from '../types';
import {
  DEFAULT_INDEX_NAME,
  loadPersistedIndex,
  savePersistedIndex,
  type PersistedFileEntry,
} from './index-persist';
import { linkSidechainParents } from './link-sidechain';
import { sanitizeForUser } from '../sanitize';

interface FileEntry {
  source: ProviderId;

  parserVersion: string;
  mtimeMs: number;
  size: number;
  assistantRecords: AssistantRecord[];
  userRecords: UserRecord[];
  parentLinks: Array<[string, string | null]>;
}

interface SnapshotExtended extends ScanResult {
  bySource: ScanStatsBySource[];
}

export interface IndexerStatus {
  initialized: boolean;
  isIndexing: boolean;
  lastIndexedAt: string | null;
  indexDurationMs: number | null;
  filesIndexed: number;
  recordsIndexed: number;
  bySource: ScanStatsBySource[];
  watchers: number;
  errors: string[];
  pendingReconciles: number;
  loadedFromDisk: boolean;
}

const RECONCILE_DEBOUNCE_MS = 200;
const SNAPSHOT_REBUILD_DEBOUNCE_MS = 100;
const POLL_INTERVAL_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 2_000;
const SCAN_DEPTH_LIMIT = 8;
const MAX_ERROR_HISTORY = 20;

class FileIndexer {

  private readonly cacheName: string;
  private files = new Map<string, FileEntry>();
  private snapshot: SnapshotExtended | null = null;
  private watchers = new Map<string, FSWatcher>();
  private pollTimer: NodeJS.Timeout | null = null;
  private snapshotRebuildTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private fileDebouncers = new Map<string, NodeJS.Timeout>();
  private initPromise: Promise<void> | null = null;
  private isIndexing = false;
  private lastIndexedAt: string | null = null;
  private indexDurationMs: number | null = null;
  private existingDirs: string[] = [];
  private dirToProvider = new Map<string, ProviderAdapter>();
  private errors: string[] = [];
  private loadedFromDisk = false;

  private lastWorkStart: number | null = null;

  private rescanPromise: Promise<SnapshotExtended> | null = null;

  private mutationTail: Promise<unknown> = Promise.resolve();

  constructor(cacheName: string = DEFAULT_INDEX_NAME) {
    this.cacheName = cacheName;
  }

  private runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(work, work);
    this.mutationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const start = Date.now();
    this.isIndexing = true;
    this.lastWorkStart = start;
    try {
      await this.detectProviderDirs();

      const persisted = await loadPersistedIndex(this.cacheName);
      this.loadedFromDisk = persisted !== null;

      const persistedMap = new Map<string, PersistedFileEntry>();
      if (persisted) {
        for (const entry of persisted.files) persistedMap.set(entry.filePath, entry);
      }

      await this.runExclusive(async () => {
        await this.fullScan(persistedMap);
        this.rebuildSnapshotNow();
        this.indexDurationMs = Date.now() - start;
        this.lastIndexedAt = new Date().toISOString();
        this.schedulePersist();
      });
      this.syncWatchersToDirs();
      this.setupPolling();
    } finally {
      this.isIndexing = false;
    }
  }

  private async detectProviderDirs(): Promise<{ added: string[]; removed: string[] }> {
    const wanted = new Map<string, ProviderAdapter>();
    const dirs: string[] = [];
    for (const provider of listProviders()) {
      for (const dir of provider.getDirs()) {
        if (await dirExists(dir)) {
          if (!wanted.has(dir)) {
            wanted.set(dir, provider);
            dirs.push(dir);
          }
        }
      }
    }
    const added: string[] = [];
    const removed: string[] = [];
    for (const dir of wanted.keys()) {
      if (!this.dirToProvider.has(dir)) added.push(dir);
    }
    for (const dir of this.dirToProvider.keys()) {
      if (!wanted.has(dir)) removed.push(dir);
    }
    this.dirToProvider = wanted;
    this.existingDirs = dirs;
    return { added, removed };
  }

  private async fullScan(persistedMap: Map<string, PersistedFileEntry>): Promise<void> {
    const fileTasks: Array<{ file: string; provider: ProviderAdapter }> = [];
    for (const [dir, provider] of this.dirToProvider) {
      const files = await listJsonlFiles(dir, provider);
      for (const f of files) fileTasks.push({ file: f, provider });
    }

    const seenPaths = new Set<string>(fileTasks.map((t) => t.file));

    await Promise.all(
      fileTasks.map(async ({ file, provider }) => {
        try {
          const stat = await fs.stat(file);
          const persistedEntry = persistedMap.get(file);

          if (
            persistedEntry &&
            persistedEntry.source === provider.id &&
            persistedEntry.parserVersion === provider.parserVersion &&
            persistedEntry.mtimeMs === stat.mtimeMs &&
            persistedEntry.size === stat.size
          ) {
            this.files.set(file, {
              source: provider.id,
              parserVersion: provider.parserVersion,
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              assistantRecords: persistedEntry.assistantRecords,
              userRecords: persistedEntry.userRecords,
              parentLinks: persistedEntry.parentLinks,
            });
            return;
          }
          const parsed = await provider.parseFile(file);
          this.files.set(file, {
            source: provider.id,
            parserVersion: provider.parserVersion,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            assistantRecords: parsed.assistant,
            userRecords: parsed.user,
            parentLinks: parsed.parentLinks,
          });
        } catch (err) {
          this.recordError(`parse ${file}: ${(err as Error).message}`);
        }
      }),
    );

    for (const tracked of Array.from(this.files.keys())) {
      if (!seenPaths.has(tracked)) this.files.delete(tracked);
    }
  }

  private syncWatchersToDirs(): void {

    for (const [dir, watcher] of this.watchers) {
      if (!this.dirToProvider.has(dir)) {
        try {
          watcher.close();
        } catch {

        }
        this.watchers.delete(dir);
      }
    }

    for (const [dir, provider] of this.dirToProvider) {
      if (this.watchers.has(dir)) continue;
      try {
        const watcher = fsWatch(dir, { recursive: true }, (_eventType, filename) => {
          if (!filename || typeof filename !== 'string') return;
          if (!filename.endsWith('.jsonl')) return;
          const fullPath = path.join(dir, filename);
          this.scheduleFileReconcile(fullPath, provider);
        });
        watcher.on('error', (err) => {
          this.recordError(`watcher ${dir}: ${err.message}`);
        });
        this.watchers.set(dir, watcher);
      } catch (err) {
        this.recordError(`watch ${dir}: ${(err as Error).message}`);
      }
    }
  }

  private setupPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);

    const isMcp = this.cacheName === 'mcp';
    const envOpt = process.env.CCGAUGE_POLL_FALLBACK;
    const enable = envOpt === '1' ? true : envOpt === '0' ? false : !isMcp;
    if (!enable) return;
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch((err) => this.recordError(`poll: ${(err as Error).message}`));
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  private async pollOnce(): Promise<void> {
    await this.runExclusive(async () => {
      const start = Date.now();

      const dirDiff = await this.detectProviderDirs();
      let changed = dirDiff.added.length > 0 || dirDiff.removed.length > 0;
      if (changed) this.syncWatchersToDirs();

      const fileTasks: Array<{ file: string; provider: ProviderAdapter }> = [];
      for (const [dir, provider] of this.dirToProvider) {
        const files = await listJsonlFiles(dir, provider);
        for (const f of files) fileTasks.push({ file: f, provider });
      }
      const seenPaths = new Set<string>(fileTasks.map((t) => t.file));
      await Promise.all(
        fileTasks.map(async ({ file, provider }) => {
          try {
            const stat = await fs.stat(file);
            const existing = this.files.get(file);
            if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
              return;
            }
            const parsed = await provider.parseFile(file);
            this.files.set(file, {
              source: provider.id,
              parserVersion: provider.parserVersion,
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              assistantRecords: parsed.assistant,
              userRecords: parsed.user,
              parentLinks: parsed.parentLinks,
            });
            changed = true;
          } catch (err) {
            this.recordError(`poll-parse ${file}: ${(err as Error).message}`);
          }
        }),
      );
      for (const tracked of Array.from(this.files.keys())) {
        if (!seenPaths.has(tracked)) {
          this.files.delete(tracked);
          changed = true;
        }
      }
      if (changed) {
        this.lastWorkStart = start;
        this.scheduleSnapshotRebuild();
        this.schedulePersist();
      }
    });
  }

  private scheduleFileReconcile(filePath: string, provider: ProviderAdapter): void {
    const existing = this.fileDebouncers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.fileDebouncers.delete(filePath);
      this.reconcileFile(filePath, provider).catch((err) =>
        this.recordError(`reconcile ${filePath}: ${(err as Error).message}`),
      );
    }, RECONCILE_DEBOUNCE_MS);
    timer.unref?.();
    this.fileDebouncers.set(filePath, timer);
  }

  private async reconcileFile(filePath: string, provider: ProviderAdapter): Promise<void> {
    await this.runExclusive(async () => {
      const workStart = Date.now();
      let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
      try {
        stat = await fs.stat(filePath);
      } catch {

      }
      if (!stat || !stat.isFile()) {
        if (this.files.has(filePath)) {
          this.files.delete(filePath);
          this.lastWorkStart = workStart;
          this.scheduleSnapshotRebuild();
          this.schedulePersist();
        }
        return;
      }
      const existing = this.files.get(filePath);
      if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
        return;
      }
      try {
        const parsed = await provider.parseFile(filePath);
        this.files.set(filePath, {
          source: provider.id,
          parserVersion: provider.parserVersion,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          assistantRecords: parsed.assistant,
          userRecords: parsed.user,
          parentLinks: parsed.parentLinks,
        });
        this.lastWorkStart = workStart;
        this.scheduleSnapshotRebuild();
        this.schedulePersist();
      } catch (err) {
        this.recordError(`parse ${filePath}: ${(err as Error).message}`);
      }
    });
  }

  private scheduleSnapshotRebuild(): void {
    if (this.snapshotRebuildTimer) clearTimeout(this.snapshotRebuildTimer);
    this.snapshotRebuildTimer = setTimeout(() => {
      this.snapshotRebuildTimer = null;
      this.rebuildSnapshotNow();
    }, SNAPSHOT_REBUILD_DEBOUNCE_MS);
    this.snapshotRebuildTimer.unref?.();
  }

  private rebuildSnapshotNow(): void {
    const snapshotStart = Date.now();
    const workStart = this.lastWorkStart ?? snapshotStart;
    const assistant: AssistantRecord[] = [];
    const user: UserRecord[] = [];
    const parentMap: Record<string, string | null> = {};
    let recordsParsed = 0;

    const bySource: Record<ProviderId, ScanStatsBySource> = {
      claude: {
        source: 'claude',
        filesScanned: 0,
        recordsParsed: 0,
        assistantRecords: 0,
        scannedDirs: [],
      },
      codex: {
        source: 'codex',
        filesScanned: 0,
        recordsParsed: 0,
        assistantRecords: 0,
        scannedDirs: [],
      },
    };
    for (const [dir, provider] of this.dirToProvider) {
      bySource[provider.id].scannedDirs.push(dir);
    }

    for (const entry of this.files.values()) {
      assistant.push(...entry.assistantRecords);
      user.push(...entry.userRecords);
      for (const [uuid, parent] of entry.parentLinks) parentMap[uuid] = parent;
      recordsParsed += entry.assistantRecords.length + entry.userRecords.length;
      bySource[entry.source].filesScanned += 1;
      bySource[entry.source].recordsParsed +=
        entry.assistantRecords.length + entry.userRecords.length;
    }

    const dedupedAssistants = dedupAssistantRecords(assistant).sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const dedupedUsers = dedupUserRecords(user).sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );

    linkSidechainParents({
      assistantRecords: dedupedAssistants,
      userRecords: dedupedUsers,
      parentMap,
    });

    for (const rec of dedupedAssistants) bySource[rec.source].assistantRecords += 1;

    const stats: ScanStats = {
      filesScanned: this.files.size,
      recordsParsed,
      assistantRecords: dedupedAssistants.length,

      durationMs: Date.now() - workStart,
      scannedDirs: this.existingDirs,
    };

    this.snapshot = {
      records: dedupedAssistants,
      userRecords: dedupedUsers,
      parentMap,
      stats,
      bySource: Object.values(bySource),
    };
    this.lastWorkStart = null;
  }

  getSnapshot(): SnapshotExtended {
    if (!this.snapshot) {
      throw new Error('Indexer not initialized — call init() first.');
    }
    return this.snapshot;
  }

  async forceRescan(): Promise<SnapshotExtended> {

    const isFirstInit = !this.initPromise;

    await this.init();

    if (isFirstInit) return this.snapshot!;

    if (this.rescanPromise) return this.rescanPromise;
    this.rescanPromise = this.runRescan();
    try {
      return await this.rescanPromise;
    } finally {
      this.rescanPromise = null;
    }
  }

  private async runRescan(): Promise<SnapshotExtended> {
    this.isIndexing = true;
    try {
      return await this.runExclusive(async () => {
        const start = Date.now();
        this.lastWorkStart = start;
        if (this.snapshotRebuildTimer) {
          clearTimeout(this.snapshotRebuildTimer);
          this.snapshotRebuildTimer = null;
        }
        if (this.persistTimer) {
          clearTimeout(this.persistTimer);
          this.persistTimer = null;
        }
        this.files.clear();
        await this.detectProviderDirs();
        await this.fullScan(new Map());
        this.rebuildSnapshotNow();
        this.indexDurationMs = Date.now() - start;
        this.lastIndexedAt = new Date().toISOString();
        this.syncWatchersToDirs();
        this.schedulePersist();
        return this.snapshot!;
      });
    } finally {
      this.isIndexing = false;
    }
  }

  getStatus(): IndexerStatus {
    const snap = this.snapshot;
    return {
      initialized: snap !== null,
      isIndexing: this.isIndexing,
      lastIndexedAt: this.lastIndexedAt,
      indexDurationMs: this.indexDurationMs,
      filesIndexed: this.files.size,
      recordsIndexed: snap?.stats.assistantRecords ?? 0,
      bySource: snap?.bySource ?? [],
      watchers: this.watchers.size,
      errors: this.errors.slice(-MAX_ERROR_HISTORY),
      pendingReconciles: this.fileDebouncers.size,
      loadedFromDisk: this.loadedFromDisk,
    };
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const entries: PersistedFileEntry[] = [];
      for (const [filePath, entry] of this.files) {
        entries.push({
          filePath,
          source: entry.source,
          parserVersion: entry.parserVersion,
          mtimeMs: entry.mtimeMs,
          size: entry.size,
          assistantRecords: entry.assistantRecords,
          userRecords: entry.userRecords,
          parentLinks: entry.parentLinks,
        });
      }
      savePersistedIndex(
        {
          savedAt: new Date().toISOString(),
          files: entries,
        },
        this.cacheName,
      ).catch((err) => this.recordError(`persist: ${(err as Error).message}`));
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  private recordError(msg: string): void {
    const stamped = `${new Date().toISOString()} ${sanitizeForUser(msg)}`;
    this.errors.push(stamped);
    if (this.errors.length > MAX_ERROR_HISTORY * 2) {
      this.errors.splice(0, this.errors.length - MAX_ERROR_HISTORY);
    }
    if (process.env.CCGAUGE_DEBUG) {

      console.error(`[ccgauge:indexer] ${new Date().toISOString()} ${msg}`);
    }
  }

  private disposeWatchers(): void {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {

      }
    }
    this.watchers.clear();
  }

  dispose(): void {
    this.disposeWatchers();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.snapshotRebuildTimer) clearTimeout(this.snapshotRebuildTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    for (const t of this.fileDebouncers.values()) clearTimeout(t);
    this.fileDebouncers.clear();
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function listJsonlFiles(rootDir: string, provider: ProviderAdapter): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > SCAN_DEPTH_LIMIT) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (provider.shouldSkipDir(e.name)) continue;
        await walk(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
  }
  await walk(rootDir, 0);
  return out;
}

function dedupUserRecords(records: UserRecord[]): UserRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const k = r.uuid;
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

declare global {
  var __ccgaugeIndexers: Map<string, FileIndexer> | undefined;
}

function indexerRegistry(): Map<string, FileIndexer> {
  if (!globalThis.__ccgaugeIndexers) {
    globalThis.__ccgaugeIndexers = new Map();
  }
  return globalThis.__ccgaugeIndexers;
}

export function getIndexer(cacheName: string = DEFAULT_INDEX_NAME): FileIndexer {
  const reg = indexerRegistry();
  let inst = reg.get(cacheName);
  if (!inst) {
    inst = new FileIndexer(cacheName);
    reg.set(cacheName, inst);
  }
  return inst;
}
