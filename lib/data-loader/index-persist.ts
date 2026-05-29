import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AssistantRecord, ProviderId, UserRecord } from '../types';

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

export async function loadPersistedIndex(
  name: string = DEFAULT_INDEX_NAME,
): Promise<PersistedIndex | null> {
  const filePath = getIndexPath(name);
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
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, filePath);
}

export async function clearPersistedIndex(
  name: string = DEFAULT_INDEX_NAME,
): Promise<void> {
  try {
    await fs.unlink(getIndexPath(name));
  } catch {

  }
}
