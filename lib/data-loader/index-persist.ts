import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AssistantRecord, ProviderId, UserRecord } from '../types';
import type { SpawnedSessionLink } from '../providers/types';

const SCHEMA_VERSION = 3;
const LEGACY_SCHEMA_VERSION = 2;
const SHARD_COUNT = 64;
const SHARD_RE = /^shard-[0-9a-f]{2}\.json$/;

export const DEFAULT_INDEX_NAME = 'default';

export interface PersistedFileEntry {
  filePath: string;
  source: ProviderId;

  parserVersion: string;
  mtimeMs: number;
  size: number;
  assistantRecords: AssistantRecord[];
  userRecords: UserRecord[];
  parentLinks: Array<[string, string | null]>;
  // Optional: absent in caches written before this field existed. Those are
  // discarded anyway on the `parserVersion` bump that introduced it.
  spawnedSessions?: SpawnedSessionLink[];
}

export interface PersistedIndex {
  schemaVersion: number;
  savedAt: string;
  files: PersistedFileEntry[];
  legacy?: boolean;
}

interface ShardFile {
  schemaVersion: number;
  savedAt: string;
  files: PersistedFileEntry[];
}

function getStateDir(): string {
  if (process.env.CCGAUGE_STATE_DIR) return process.env.CCGAUGE_STATE_DIR;
  return path.join(os.homedir(), '.ccgauge');
}

function getCacheDir(): string {
  return path.join(getStateDir(), 'cache');
}

function getIndexDir(name: string): string {
  const dirName =
    name === DEFAULT_INDEX_NAME ? `index-v${SCHEMA_VERSION}` : `index-${name}-v${SCHEMA_VERSION}`;
  return path.join(getCacheDir(), dirName);
}

function getLegacyIndexPath(name: string): string {
  const fileName =
    name === DEFAULT_INDEX_NAME
      ? `index-v${LEGACY_SCHEMA_VERSION}.json`
      : `index-${name}-v${LEGACY_SCHEMA_VERSION}.json`;
  return path.join(getCacheDir(), fileName);
}

export function shardOf(filePath: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < filePath.length; i += 1) {
    h ^= filePath.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % SHARD_COUNT;
}

function shardPath(dir: string, shard: number): string {
  return path.join(dir, `shard-${shard.toString(16).padStart(2, '0')}.json`);
}

// A crashed or killed process leaves its `<index>.tmp-<pid>` behind, and
// nothing ever collected them: 125 orphans totalling 2.2GB accumulated over
// three months on one machine, the oldest from another quarter.
//
// Swept by age rather than by pid liveness — pids get recycled, and no
// legitimate write stays open for an hour (a 140MB index lands in seconds).
// Swept across the whole cache dir rather than per index name, because each
// index only ever cleans its own: the dashboard's temps outnumbered by the
// MCP server's 6:1 on that machine, and neither would touch the other's.
const TMP_MAX_AGE_MS = 60 * 60 * 1000;
const TMP_NAME_RE = /\.tmp-\d+$/;

async function sweepStaleTmp(dir: string, keep?: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - TMP_MAX_AGE_MS;
  await Promise.all(
    names.map(async (name) => {
      if (!TMP_NAME_RE.test(name)) return;
      const full = path.join(dir, name);
      if (full === keep) return;
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs > cutoff) return;
        await fs.unlink(full);
      } catch {
        // Raced with another sweeper, or another process still owns it.
      }
    }),
  );
}

function hydrate(entry: PersistedFileEntry): PersistedFileEntry {
  for (const rec of entry.assistantRecords) rec.filePath = entry.filePath;
  for (const rec of entry.userRecords) rec.filePath = entry.filePath;
  return entry;
}

function withoutRecordPaths(entry: PersistedFileEntry): PersistedFileEntry {
  return {
    ...entry,
    assistantRecords: entry.assistantRecords.map(({ filePath: _filePath, ...rest }) => rest as AssistantRecord),
    userRecords: entry.userRecords.map(({ filePath: _filePath, ...rest }) => rest as UserRecord),
  };
}

async function readShard(file: string): Promise<ShardFile | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as ShardFile;
    if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadLegacyIndex(name: string): Promise<PersistedIndex | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(getLegacyIndexPath(name), 'utf8')) as PersistedIndex;
    if (parsed.schemaVersion !== LEGACY_SCHEMA_VERSION || !Array.isArray(parsed.files)) return null;
    return { ...parsed, legacy: true };
  } catch {
    return null;
  }
}

export async function loadPersistedIndex(
  name: string = DEFAULT_INDEX_NAME,
): Promise<PersistedIndex | null> {
  const dir = getIndexDir(name);
  // Startup is the one moment we know no write of ours is in flight, so it is
  // the natural place to collect whatever a previous run left behind.
  void sweepStaleTmp(getCacheDir());
  void sweepStaleTmp(dir);
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => SHARD_RE.test(n));
  } catch {
    names = [];
  }
  if (names.length === 0) return loadLegacyIndex(name);

  const shards = await Promise.all(names.map((n) => readShard(path.join(dir, n))));
  const files: PersistedFileEntry[] = [];
  let savedAt = '';
  for (const shard of shards) {
    if (!shard) continue;
    if (shard.savedAt > savedAt) savedAt = shard.savedAt;
    for (const entry of shard.files) files.push(hydrate(entry));
  }
  return { schemaVersion: SCHEMA_VERSION, savedAt, files };
}

async function writeShard(file: string, data: ShardFile): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
  } catch (err) {
    // A failed write must not become one more orphan.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function savePersistedIndex(
  payload: {
    savedAt: string;
    files: PersistedFileEntry[];
  },
  name: string = DEFAULT_INDEX_NAME,
  opts: { dirtyPaths?: Iterable<string> } = {},
): Promise<void> {
  const dir = getIndexDir(name);
  await fs.mkdir(dir, { recursive: true });

  const byShard = new Map<number, PersistedFileEntry[]>();
  for (const entry of payload.files) {
    const shard = shardOf(entry.filePath);
    const list = byShard.get(shard);
    if (list) list.push(entry);
    else byShard.set(shard, [entry]);
  }

  const targets = opts.dirtyPaths
    ? Array.from(new Set(Array.from(opts.dirtyPaths, shardOf)))
    : Array.from({ length: SHARD_COUNT }, (_, i) => i);

  for (const shard of targets) {
    const file = shardPath(dir, shard);
    const entries = byShard.get(shard);
    if (!entries || entries.length === 0) {
      await fs.rm(file, { force: true });
      continue;
    }
    await writeShard(file, {
      schemaVersion: SCHEMA_VERSION,
      savedAt: payload.savedAt,
      files: entries.map(withoutRecordPaths),
    });
  }

  if (!opts.dirtyPaths) await fs.rm(getLegacyIndexPath(name), { force: true });
  await sweepStaleTmp(dir);
  await sweepStaleTmp(getCacheDir());
}

export async function clearPersistedIndex(
  name: string = DEFAULT_INDEX_NAME,
): Promise<void> {
  await fs.rm(getIndexDir(name), { recursive: true, force: true });
  await fs.rm(getLegacyIndexPath(name), { force: true });
}
