import { promises as fs, watch as fsWatch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dedupAssistantRecords } from '../dedup';
import { listProviders } from '../providers';
import type { ProviderAdapter, ProviderId, SpawnedSessionLink } from '../providers';
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
import { linkSidechainParents, detectSubagentKind } from './link-sidechain';
import { parseTranscript } from './parse-pool';
import { sanitizeForUser } from '../sanitize';

interface FileEntry {
  source: ProviderId;

  parserVersion: string;
  mtimeMs: number;
  size: number;
  assistantRecords: AssistantRecord[];
  userRecords: UserRecord[];
  parentLinks: Array<[string, string | null]>;
  spawnedSessions: SpawnedSessionLink[];
  parsedBytes?: number;
  tailHash?: string;
}

interface SnapshotExtended extends ScanResult {
  bySource: ScanStatsBySource[];
}

interface ScanTask {
  file: string;
  provider: ProviderAdapter;
}

interface SizedTask extends ScanTask {
  mtimeMs: number;
  size: number;
  previous?: Omit<FileEntry, 'spawnedSessions'> & { spawnedSessions?: SpawnedSessionLink[] };
}

export interface IndexerProgress {
  phase: 'idle' | 'indexing' | 'refreshing';
  reason: 'upgrade' | 'backfill' | null;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
}

const IDLE_PROGRESS: IndexerProgress = {
  phase: 'idle',
  reason: null,
  filesTotal: 0,
  filesDone: 0,
  bytesTotal: 0,
  bytesDone: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_WINDOW_DAYS = 30;

function recentCutoffMs(now: Date = new Date()): number {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return Math.min(monthStart, now.getTime() - RECENT_WINDOW_DAYS * DAY_MS) - DAY_MS;
}

function sumSizes(tasks: SizedTask[]): number {
  let total = 0;
  for (const t of tasks) total += t.size;
  return total;
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
  progress: IndexerProgress;
}

const RECONCILE_DEBOUNCE_MS = 200;
const SNAPSHOT_REBUILD_DEBOUNCE_MS = 100;
const POLL_INTERVAL_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 2_000;
const SCAN_DEPTH_LIMIT = 8;
const MAX_ERROR_HISTORY = 20;

// Cap how many files are parsed at once. A `Promise.all` over the whole file
// list looks harmless at a few hundred transcripts, but a heavy user can have
// 20k+ of them — at which point every one of those tasks holds an open read
// stream (64 KB buffer each) and its fully parsed records at the same time, so
// the cold index degrades into GC thrash and takes minutes instead of seconds.
// It also builds an async chain thousands of nodes deep, which overflows the
// stack inside Next.js dev's recursive async-debug walker (`visitAsyncNode`)
// and surfaces as an unrelated-looking "Maximum call stack size exceeded".
// Parsing is IO-bound, so a small multiple of the core count saturates the disk
// without any of that.
const SCAN_CONCURRENCY = Math.max(8, Math.min(32, (os.cpus()?.length ?? 4) * 4));

// Run `worker` over `items` with at most `limit` in flight. Each lane pulls the
// next index and awaits sequentially, so the async chain stays shallow no
// matter how long `items` is.
async function forEachLimited<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const lanes: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    lanes.push(
      (async () => {
        for (;;) {
          const idx = cursor;
          cursor += 1;
          if (idx >= items.length) return;
          await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(lanes);
}

class FileIndexer {

  private readonly cacheName: string;
  private files = new Map<string, FileEntry>();
  private snapshot: SnapshotExtended | null = null;
  private watchers = new Map<string, FSWatcher>();
  private pollTimer: NodeJS.Timeout | null = null;
  private snapshotRebuildTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private dirtyPaths = new Set<string>();
  private fullPersist = false;
  private persistChain: Promise<void> = Promise.resolve();
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

  private refreshPromise: Promise<void> | null = null;
  private progress: IndexerProgress = IDLE_PROGRESS;

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
    this.progress = { ...IDLE_PROGRESS, phase: 'indexing' };
    try {
      await this.detectProviderDirs();

      const persisted = await loadPersistedIndex(this.cacheName);
      this.loadedFromDisk = persisted !== null;

      const persistedMap = new Map<string, PersistedFileEntry>();
      if (persisted) {
        for (const entry of persisted.files) persistedMap.set(entry.filePath, entry);
      }

      const scan = await this.runExclusive(async () => {
        const result = await this.fullScan(persistedMap, { deferOlder: true });
        this.rebuildSnapshotNow();
        this.indexDurationMs = Date.now() - start;
        this.lastIndexedAt = new Date().toISOString();
        if (persisted?.legacy) this.fullPersist = true;
        for (const cached of persistedMap.keys()) {
          if (!this.files.has(cached)) this.dirtyPaths.add(cached);
        }
        if (this.fullPersist || this.dirtyPaths.size > 0) this.schedulePersist();
        return result;
      });
      this.syncWatchersToDirs();
      this.setupPolling();
      const pending = [...scan.backfill, ...scan.outdated];
      if (pending.length > 0) {
        this.startRefresh(pending, scan.backfill.length > 0 ? 'backfill' : 'upgrade');
      } else {
        this.progress = IDLE_PROGRESS;
      }
    } finally {
      this.isIndexing = this.refreshPromise !== null;
      if (!this.refreshPromise && this.progress.phase === 'indexing') this.progress = IDLE_PROGRESS;
    }
  }

  private startRefresh(tasks: SizedTask[], reason: 'upgrade' | 'backfill'): void {
    this.progress = {
      phase: 'refreshing',
      reason,
      filesTotal: tasks.length,
      filesDone: 0,
      bytesTotal: sumSizes(tasks),
      bytesDone: 0,
    };
    this.isIndexing = true;
    const run = this.runExclusive(async () => {
      const start = Date.now();
      await forEachLimited(tasks, SCAN_CONCURRENCY, async (task) => {
        const existing = this.files.get(task.file);
        if (existing && existing.parserVersion === task.provider.parserVersion) {
          this.advanceProgress(task.size);
          return;
        }
        await this.parseInto(task, 'refresh');
      });
      this.lastWorkStart = start;
      this.rebuildSnapshotNow();
      this.indexDurationMs = Date.now() - start;
      this.lastIndexedAt = new Date().toISOString();
      this.schedulePersist();
    });
    this.refreshPromise = run
      .catch((err) => this.recordError(`refresh: ${(err as Error).message}`))
      .finally(() => {
        this.refreshPromise = null;
        if (this.progress.phase === 'refreshing') this.progress = IDLE_PROGRESS;
        this.isIndexing = this.rescanPromise !== null;
      });
  }

  private advanceProgress(bytes: number): void {
    this.progress = {
      ...this.progress,
      filesDone: this.progress.filesDone + 1,
      bytesDone: this.progress.bytesDone + bytes,
    };
  }

  private async readEntry(task: SizedTask): Promise<FileEntry> {
    const { file, provider, mtimeMs, size, previous } = task;
    if (
      previous &&
      previous.source === provider.id &&
      previous.parserVersion === provider.parserVersion &&
      previous.parsedBytes !== undefined &&
      previous.tailHash !== undefined &&
      size >= previous.parsedBytes &&
      provider.parseAppended &&
      provider.tailHash
    ) {
      const appendOnly = await provider
        .tailHash(file, previous.parsedBytes)
        .then((hash) => hash === previous.tailHash)
        .catch(() => false);
      if (appendOnly) {
        const tail = await provider.parseAppended(file, previous.parsedBytes);
        return {
          source: provider.id,
          parserVersion: provider.parserVersion,
          mtimeMs,
          size,
          assistantRecords: dedupAssistantRecords([...previous.assistantRecords, ...tail.assistant]),
          userRecords: [...previous.userRecords, ...tail.user],
          parentLinks: [...previous.parentLinks, ...tail.parentLinks],
          spawnedSessions: [...(previous.spawnedSessions ?? []), ...(tail.spawnedSessions ?? [])],
          parsedBytes: tail.parsedBytes,
          tailHash: tail.tailHash,
        };
      }
    }
    const parsed = await parseTranscript(provider, file);
    return {
      source: provider.id,
      parserVersion: provider.parserVersion,
      mtimeMs,
      size,
      assistantRecords: dedupAssistantRecords(parsed.assistant),
      userRecords: parsed.user,
      parentLinks: parsed.parentLinks,
      spawnedSessions: parsed.spawnedSessions ?? [],
      parsedBytes: parsed.parsedBytes,
      tailHash: parsed.tailHash,
    };
  }

  private async parseInto(task: SizedTask, label: string): Promise<void> {
    const { file, size } = task;
    try {
      const entry = await this.readEntry(task);
      this.dirtyPaths.add(file);
      this.files.set(file, entry);
    } catch (err) {
      this.recordError(`${label} ${file}: ${(err as Error).message}`);
    } finally {
      this.advanceProgress(size);
    }
  }

  async waitUntilFresh(): Promise<SnapshotExtended> {
    await this.init();
    while (this.refreshPromise) await this.refreshPromise;
    return this.getSnapshot();
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

  private async fullScan(
    persistedMap: Map<string, PersistedFileEntry>,
    opts: { deferOlder: boolean },
  ): Promise<{ outdated: SizedTask[]; backfill: SizedTask[]; parsed: number; reused: number }> {
    const fileTasks: ScanTask[] = [];
    for (const [dir, provider] of this.dirToProvider) {
      const files = await listJsonlFiles(dir, provider);
      for (const f of files) fileTasks.push({ file: f, provider });
    }

    const seenPaths = new Set<string>(fileTasks.map((t) => t.file));
    const outdated: SizedTask[] = [];
    const toParse: SizedTask[] = [];
    let reused = 0;

    await forEachLimited(
      fileTasks,
      SCAN_CONCURRENCY,
      async ({ file, provider }) => {
        try {
          const stat = await fs.stat(file);
          const persistedEntry = persistedMap.get(file);

          if (
            persistedEntry &&
            persistedEntry.source === provider.id &&
            persistedEntry.mtimeMs === stat.mtimeMs &&
            persistedEntry.size === stat.size
          ) {
            this.files.set(file, {
              source: provider.id,
              parserVersion: persistedEntry.parserVersion,
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              assistantRecords: dedupAssistantRecords(persistedEntry.assistantRecords),
              userRecords: persistedEntry.userRecords,
              parentLinks: persistedEntry.parentLinks,
              spawnedSessions: persistedEntry.spawnedSessions ?? [],
              parsedBytes: persistedEntry.parsedBytes,
              tailHash: persistedEntry.tailHash,
            });
            reused += 1;
            if (persistedEntry.parserVersion !== provider.parserVersion) {
              outdated.push({ file, provider, mtimeMs: stat.mtimeMs, size: stat.size });
            }
            return;
          }
          toParse.push({
            file,
            provider,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            previous: persistedEntry?.source === provider.id ? persistedEntry : undefined,
          });
        } catch (err) {
          this.recordError(`stat ${file}: ${(err as Error).message}`);
        }
      },
    );

    for (const tracked of Array.from(this.files.keys())) {
      if (!seenPaths.has(tracked)) {
        this.files.delete(tracked);
        this.dirtyPaths.add(tracked);
      }
    }

    const cutoff = recentCutoffMs();
    const now = opts.deferOlder ? toParse.filter((t) => t.mtimeMs >= cutoff) : toParse;
    const backfill = opts.deferOlder ? toParse.filter((t) => t.mtimeMs < cutoff) : [];
    now.sort((a, b) => b.mtimeMs - a.mtimeMs);
    backfill.sort((a, b) => b.mtimeMs - a.mtimeMs);

    this.progress = {
      phase: 'indexing',
      reason: null,
      filesTotal: now.length,
      filesDone: 0,
      bytesTotal: sumSizes(now),
      bytesDone: 0,
    };
    await forEachLimited(now, SCAN_CONCURRENCY, (task) => this.parseInto(task, 'parse'));

    return { outdated, backfill, parsed: now.length, reused };
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
      await forEachLimited(
        fileTasks,
        SCAN_CONCURRENCY,
        async ({ file, provider }) => {
          try {
            const stat = await fs.stat(file);
            const existing = this.files.get(file);
            if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
              return;
            }
            const entry = await this.readEntry({
              file,
              provider,
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              previous: existing,
            });
            this.dirtyPaths.add(file);
            this.files.set(file, entry);
            changed = true;
          } catch (err) {
            this.recordError(`poll-parse ${file}: ${(err as Error).message}`);
          }
        },
      );
      for (const tracked of Array.from(this.files.keys())) {
        if (!seenPaths.has(tracked)) {
          this.files.delete(tracked);
          this.dirtyPaths.add(tracked);
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
          this.dirtyPaths.add(filePath);
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
        const entry = await this.readEntry({
          file: filePath,
          provider,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          previous: existing,
        });
        this.dirtyPaths.add(filePath);
        this.files.set(filePath, entry);
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
    const spawnedSessions: SpawnedSessionLink[] = [];
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

    for (const filePath of Array.from(this.files.keys()).sort()) {
      const entry = this.files.get(filePath)!;
      // Appended one by one rather than with `push(...arr)`: the spread passes
      // every record as a separate argument, so a single long transcript is
      // enough to blow the argument limit and throw "Maximum call stack size
      // exceeded" here.
      for (const rec of entry.assistantRecords) assistant.push(rec);
      for (const rec of entry.userRecords) user.push(rec);
      for (const [uuid, parent] of entry.parentLinks) parentMap[uuid] = parent;
      for (const link of entry.spawnedSessions) spawnedSessions.push(link);
      recordsParsed += entry.assistantRecords.length + entry.userRecords.length;
      bySource[entry.source].filesScanned += 1;
      bySource[entry.source].recordsParsed +=
        entry.assistantRecords.length + entry.userRecords.length;
    }

    // Plain `<` / `>` instead of `localeCompare`: timestamps are ISO-8601, so
    // byte order already is chronological order, and localeCompare's ICU
    // collation costs orders of magnitude more per comparison — measurable
    // across millions of records. Matches how link-sidechain.ts sorts.
    const dedupedAssistants = dedupAssistantRecords(assistant).sort(byTimestamp);
    const dedupedUsers = dedupUserRecords(user).sort(byTimestamp);

    linkSidechainParents({
      assistantRecords: dedupedAssistants,
      userRecords: dedupedUsers,
      parentMap,
      spawnedSessions,
    });

    // Stamp each sidechain record with whether it's a Workflow (ultracode)
    // sub-agent vs a plain Task sub-agent — derived purely from the file
    // path, so it's idempotent and cache-safe to (re)compute every
    // rebuild. Drives the "Workflow" badge on the spawning turn. Only
    // sidechain records can be sub-agents, so non-sidechain records are
    // skipped (detectSubagentKind would return null anyway).
    for (const rec of dedupedAssistants) {
      if (rec.isSidechain) rec.isWorkflowSubagent = detectSubagentKind(rec.filePath) === 'workflow';
    }

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

    if (isFirstInit) return this.waitUntilFresh();

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
        this.fullPersist = true;
        await this.detectProviderDirs();
        await this.fullScan(new Map(), { deferOlder: false });
        this.rebuildSnapshotNow();
        this.indexDurationMs = Date.now() - start;
        this.lastIndexedAt = new Date().toISOString();
        this.syncWatchersToDirs();
        this.schedulePersist();
        return this.snapshot!;
      });
    } finally {
      this.isIndexing = false;
      if (this.progress.phase === 'indexing') this.progress = IDLE_PROGRESS;
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
      progress: this.progress,
    };
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const full = this.fullPersist;
      const dirty = this.dirtyPaths;
      this.fullPersist = false;
      this.dirtyPaths = new Set();
      if (!full && dirty.size === 0) return;
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
          spawnedSessions: entry.spawnedSessions,
          parsedBytes: entry.parsedBytes,
          tailHash: entry.tailHash,
        });
      }
      this.persistChain = this.persistChain
        .then(() =>
          savePersistedIndex(
            { savedAt: new Date().toISOString(), files: entries },
            this.cacheName,
            full ? {} : { dirtyPaths: dirty },
          ),
        )
        .catch((err) => {
          this.recordError(`persist: ${(err as Error).message}`);
          if (full) this.fullPersist = true;
          for (const p of dirty) this.dirtyPaths.add(p);
        });
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

function byTimestamp(a: { timestamp: string }, b: { timestamp: string }): number {
  return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
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
