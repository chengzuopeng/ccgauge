import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AssistantRecord, ProviderId, UserRecord } from '../types';
import type { SpawnedSessionLink } from '../providers/types';

const SCHEMA_VERSION = 2;

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

interface PersistedIndex {
  schemaVersion: number;
  savedAt: string;
  files: PersistedFileEntry[];
}

function getStateDir(): string {
  if (process.env.CCGAUGE_STATE_DIR) return process.env.CCGAUGE_STATE_DIR;
  return path.join(os.homedir(), '.ccgauge');
}

function getIndexPath(name: string): string {

  const fileName =
    name === DEFAULT_INDEX_NAME
      ? `index-v${SCHEMA_VERSION}.json`
      : `index-${name}-v${SCHEMA_VERSION}.json`;
  return path.join(getStateDir(), 'cache', fileName);
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

async function sweepStaleTmp(filePath: string, keep?: string): Promise<void> {
  const dir = path.dirname(filePath);
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

export async function loadPersistedIndex(
  name: string = DEFAULT_INDEX_NAME,
): Promise<PersistedIndex | null> {
  const filePath = getIndexPath(name);
  // Startup is the one moment we know no write of ours is in flight, so it is
  // the natural place to collect whatever a previous run left behind.
  void sweepStaleTmp(filePath);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as PersistedIndex;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function savePersistedIndex(
  payload: {
    savedAt: string;
    files: PersistedFileEntry[];
  },
  name: string = DEFAULT_INDEX_NAME,
): Promise<void> {
  const filePath = getIndexPath(name);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const data: PersistedIndex = {
    schemaVersion: SCHEMA_VERSION,
    savedAt: payload.savedAt,
    files: payload.files,
  };
  const tmp = `${filePath}.tmp-${process.pid}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, filePath);
  } catch (err) {
    // A failed write must not become one more orphan.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  await sweepStaleTmp(filePath, tmp);
}

export async function clearPersistedIndex(
  name: string = DEFAULT_INDEX_NAME,
): Promise<void> {
  try {
    await fs.unlink(getIndexPath(name));
  } catch {

  }
}
