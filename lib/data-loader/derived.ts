import type { AssistantRecord, UserRecord } from '../types';
import { recordsToTurnRows, type UsageTurnRow } from '../serialize';
import { resolveCanonicalCwd } from '../project-label';

/**
 * Memoize **scan-derived data** so it isn't recomputed on every navigation.
 *
 * - `allModels` / `allProjects` only depend on the scan snapshot. Once the
 *   indexer produces a new snapshot, the WeakMap entry is naturally GC'd.
 * - `recordsToTurnRows` is the dominant per-request cost (it walks the
 *   filtered records, builds turn index, resolves prompt chains, etc). An
 *   LRU keyed by (records identity + filter args) keeps common toggles
 *   (e.g. 7d ↔ 30d, source switch) hot.
 *
 * No invalidation logic needed: when the indexer rebuilds the scan, the
 * old `records` array is dereferenced; both the WeakMap and any LRU entries
 * that capture it become unreachable and get collected.
 */

const allModelsCache = new WeakMap<object, string[]>();
const allProjectsCache = new WeakMap<object, string[]>();

export function getAllModels(records: AssistantRecord[]): string[] {
  const cached = allModelsCache.get(records);
  if (cached) return cached;
  const out = Array.from(new Set(records.map((r) => r.model))).sort();
  allModelsCache.set(records, out);
  return out;
}

export function getAllProjects(records: AssistantRecord[]): string[] {
  const cached = allProjectsCache.get(records);
  if (cached) return cached;
  const out = Array.from(
    new Set(records.map((r) => resolveCanonicalCwd(r.cwd)).filter(Boolean)),
  ).sort();
  allProjectsCache.set(records, out);
  return out;
}

/**
 * Cache of computed turn-row lists, anchored on the **scan** identity (which
 * is stable across requests — same indexer snapshot ⇒ same `scan` reference)
 * and sub-keyed by a filter string. Derived arrays like
 * `filterBySource('codex')` produce a NEW array on every call, so anchoring
 * on those would always miss; anchoring on `scan` gives us a real cache.
 *
 * Tied to scan via WeakMap so any new snapshot drops the whole cache for
 * free — no manual invalidation needed.
 */
const TURNS_LRU_MAX = 16;
type TurnsLruBucket = Map<string, UsageTurnRow[]>;
const turnsByScan = new WeakMap<object, TurnsLruBucket>();

function bucketFor(scan: object): TurnsLruBucket {
  let b = turnsByScan.get(scan);
  if (!b) {
    b = new Map();
    turnsByScan.set(scan, b);
  }
  return b;
}

/**
 * Cached `recordsToTurnRows`. Caller supplies the stable `scan` object plus a
 * `filterKey` that uniquely identifies the filter combo (source, from, to,
 * models, projects). On hit returns immediately; on miss computes and bumps
 * to MRU, capped at TURNS_LRU_MAX entries per scan.
 */
export function recordsToTurnRowsCached(
  scan: object,
  filterKey: string,
  records: AssistantRecord[],
  users: UserRecord[],
  parentMap: Record<string, string | null>,
): UsageTurnRow[] {
  const bucket = bucketFor(scan);
  const hit = bucket.get(filterKey);
  if (hit) {
    // Map iteration order is insertion order — re-insert to mark MRU.
    bucket.delete(filterKey);
    bucket.set(filterKey, hit);
    return hit;
  }
  const value = recordsToTurnRows(records, users, parentMap);
  bucket.set(filterKey, value);
  while (bucket.size > TURNS_LRU_MAX) {
    const firstKey = bucket.keys().next().value;
    if (firstKey === undefined) break;
    bucket.delete(firstKey);
  }
  return value;
}
