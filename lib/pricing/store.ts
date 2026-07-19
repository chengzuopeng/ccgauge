import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Pricing } from '../types';
import { BUILTIN_PRICING } from './builtin';
import { BUILTIN_PRICING_OPENAI } from '../providers/codex/pricing';
import { LITELLM_URL, transformLiteLLMTable } from './litellm-transform.js';
import { validatePricingTables, mergeOverlay, buildFallback } from './merge.js';
import type {
  PricingSource,
  PricingMeta,
  RefreshStatus,
  RefreshResult,
} from './pricing-meta';

export type { PricingSource, PricingMeta, RefreshStatus, RefreshResult };

/**
 * Runtime pricing store. Layers a fresher, on-disk LiteLLM overlay on top of the
 * committed offline snapshot (`BUILTIN_PRICING` / `BUILTIN_PRICING_OPENAI`), and
 * can refresh that overlay from LiteLLM at boot or on demand.
 *
 * Design contract:
 *   - Reads are SYNCHRONOUS (`resolvePricing` on the hot path is sync). The merged
 *     map is materialized once into a `globalThis` singleton via a one-time
 *     `readFileSync` of the ~20 KB overlay; later refreshes swap the map atomically.
 *   - The base snapshot is ALWAYS the floor — a missing/corrupt/failed overlay
 *     degrades to built-in prices, never to an empty table.
 *   - Only the web server fetches (via boot hook / refresh API). The MCP + CLI
 *     bundles import this module and read the disk overlay, but never fetch — they
 *     get whatever the web app last cached, deterministically.
 *   - `CCGAUGE_OFFLINE=1` (or `CCGAUGE_PRICING_OFFLINE=1`) disables all fetching.
 */

interface DiskOverlay {
  version: number;
  fetchedAt: string;
  source: string;
  claude: Record<string, Pricing>;
  openai: Record<string, Pricing>;
}

interface StoreState {
  claude: Record<string, Pricing>;
  openai: Record<string, Pricing>;
  claudeFallback: Record<string, Pricing>;
  openaiFallback: Record<string, Pricing>;
  source: PricingSource;
  fetchedAt: string | null;
}

const CACHE_VERSION = 1;
const CACHE_FILE = 'litellm-pricing.json';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
// Sanity floors: reject an overlay far smaller than the committed snapshot
// (23 claude / 114 openai at time of writing) so an upstream bad commit can't
// shrink the table and silently corrupt cost math.
const MIN_CLAUDE = 15;
const MIN_OPENAI = 80;

// Same anchor keys as the pre-store hand-wired fallbacks, but resolved against the
// MERGED map so a refreshed price for the anchor model flows into the fallback too.
const CLAUDE_FALLBACK_ANCHORS: Record<string, string> = {
  fable: 'claude-fable-5',
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};
const OPENAI_FALLBACK_ANCHORS: Record<string, string> = {
  gpt: 'gpt-5.5',
  o: 'o3',
};

function isOffline(): boolean {
  return (
    process.env.CCGAUGE_OFFLINE === '1' ||
    process.env.CCGAUGE_PRICING_OFFLINE === '1'
  );
}

function ttlMs(): number {
  const raw = process.env.CCGAUGE_PRICING_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS;
}

function stateDir(): string {
  if (process.env.CCGAUGE_STATE_DIR) return process.env.CCGAUGE_STATE_DIR;
  return path.join(os.homedir(), '.ccgauge');
}

function cachePath(): string {
  return path.join(stateDir(), 'cache', CACHE_FILE);
}

interface PricingGlobal {
  state: StoreState | null;
  inflight: Promise<RefreshResult> | null;
}

function g(): PricingGlobal {
  const gt = globalThis as unknown as { __ccgaugePricing?: PricingGlobal };
  if (!gt.__ccgaugePricing) gt.__ccgaugePricing = { state: null, inflight: null };
  return gt.__ccgaugePricing;
}

function validate(
  claude: Record<string, Pricing>,
  openai: Record<string, Pricing>,
): string | null {
  return validatePricingTables(claude, openai, {
    minClaude: MIN_CLAUDE,
    minOpenai: MIN_OPENAI,
  });
}

function buildState(overlay: DiskOverlay | null): StoreState {
  const claude = mergeOverlay(BUILTIN_PRICING, overlay?.claude);
  const openai = mergeOverlay(BUILTIN_PRICING_OPENAI, overlay?.openai);
  return {
    claude,
    openai,
    claudeFallback: buildFallback(claude, CLAUDE_FALLBACK_ANCHORS),
    openaiFallback: buildFallback(openai, OPENAI_FALLBACK_ANCHORS),
    source: overlay ? 'cache' : 'builtin',
    fetchedAt: overlay?.fetchedAt ?? null,
  };
}

function parseOverlay(raw: string): DiskOverlay | null {
  try {
    const parsed = JSON.parse(raw) as DiskOverlay;
    if (!parsed || parsed.version !== CACHE_VERSION) return null;
    if (typeof parsed.fetchedAt !== 'string') return null;
    if (!parsed.claude || !parsed.openai) return null;
    if (validate(parsed.claude, parsed.openai)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readOverlaySync(): DiskOverlay | null {
  try {
    return parseOverlay(readFileSync(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

async function readOverlayAsync(): Promise<DiskOverlay | null> {
  try {
    return parseOverlay(await fsp.readFile(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

async function writeOverlay(overlay: DiskOverlay): Promise<void> {
  const file = cachePath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(overlay));
  await fsp.rename(tmp, file);
}

function ensureState(): StoreState {
  const store = g();
  if (store.state) return store.state;
  store.state = buildState(readOverlaySync());
  return store.state;
}

/**
 * Ensure the merged pricing state is materialized into the `globalThis` slot that
 * the provider `resolvePricing` functions read. Called for its side effect at
 * `lib/providers/index.ts` load so every runtime (web, MCP, CLI) picks up the
 * on-disk overlay without the providers importing this module.
 */
export function ensurePricingLoaded(): void {
  ensureState();
}

export function getClaudePricing(): Record<string, Pricing> {
  return ensureState().claude;
}

export function getOpenAIPricing(): Record<string, Pricing> {
  return ensureState().openai;
}

export function getPricingMeta(): PricingMeta {
  const s = ensureState();
  return {
    source: s.source,
    fetchedAt: s.fetchedAt,
    claudeCount: Object.keys(s.claude).length,
    openaiCount: Object.keys(s.openai).length,
    offline: isOffline(),
  };
}

function overlayAgeMs(overlay: DiskOverlay): number {
  const t = Date.parse(overlay.fetchedAt);
  if (!Number.isFinite(t)) return Infinity;
  return Date.now() - t;
}

async function fetchTable(): Promise<{
  claude: Record<string, Pricing>;
  openai: Record<string, Pricing>;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LITELLM_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching LiteLLM pricing`);
    return transformLiteLLMTable(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refresh the on-disk overlay from LiteLLM. Single-flight (concurrent callers
 * share one in-flight fetch). Non-forced calls short-circuit when the disk copy
 * is still within TTL. Never throws — failures return `{status:'error'}` and the
 * current (built-in or previously-cached) prices stay in place.
 */
export function refreshPricing(opts?: { force?: boolean }): Promise<RefreshResult> {
  const force = opts?.force ?? false;
  if (isOffline()) {
    return Promise.resolve({ status: 'offline', meta: getPricingMeta() });
  }
  // Synchronous fast path (in-memory, no IO): a fresh cache and a non-forced call
  // is already done. Kept OUTSIDE the single-flight block below — a branch that
  // returns before the IIFE's first `await` would run the `finally` (inflight =
  // null) BEFORE `store.inflight = run`, stranding a resolved promise in
  // `inflight` and making every later call (incl. force) short-circuit to it.
  if (!force) {
    const st = g().state;
    if (
      st?.source === 'cache' &&
      st.fetchedAt &&
      Date.now() - Date.parse(st.fetchedAt) < ttlMs()
    ) {
      return Promise.resolve({ status: 'fresh', meta: getPricingMeta() });
    }
  }
  const store = g();
  if (store.inflight) return store.inflight;

  const run = (async (): Promise<RefreshResult> => {
    try {
      if (!force) {
        const existing = await readOverlayAsync();
        if (existing && overlayAgeMs(existing) < ttlMs()) {
          store.state = buildState(existing);
          return { status: 'fresh', meta: getPricingMeta() };
        }
      }
      const { claude, openai } = await fetchTable();
      const reason = validate(claude, openai);
      if (reason) {
        return {
          status: 'error',
          message: `validation failed: ${reason}`,
          meta: getPricingMeta(),
        };
      }
      const overlay: DiskOverlay = {
        version: CACHE_VERSION,
        fetchedAt: new Date().toISOString(),
        source: 'litellm',
        claude,
        openai,
      };
      await writeOverlay(overlay);
      store.state = buildState(overlay);
      return { status: 'refreshed', meta: getPricingMeta() };
    } catch (err) {
      return { status: 'error', message: (err as Error).message, meta: getPricingMeta() };
    } finally {
      store.inflight = null;
    }
  })();

  store.inflight = run;
  return run;
}

