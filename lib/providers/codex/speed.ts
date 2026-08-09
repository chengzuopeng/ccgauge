import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Pricing } from '@/lib/types';

/**
 * Codex fast / priority service tier detection.
 *
 * Detection mirrors ccusage's `adapter/codex/speed.rs`: a Codex install is
 * "on the fast tier" iff `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`)
 * has a top-level `service_tier = "fast"` or `"priority"`. When active, every
 * Codex record is billed at a per-model multiplier (gpt-5.5 → 2.5x, others →
 * 2x by default). When inactive, every record bills at the standard rate.
 *
 * Why global / not per-turn: the rollout JSONL does NOT record the active
 * service tier per turn — it's a user-level account setting that changes when
 * the user toggles it. We adopt ccusage's pragmatic choice: read the CURRENT
 * config and apply uniformly. The known limitation is that historical turns
 * recorded under a different tier than the current setting will be billed at
 * the wrong rate — there's no way to recover that information from the data.
 *
 * The earlier v1.2.0 implementation cached the config read at module load,
 * which meant editing config.toml required restarting the dashboard. v1.2.2
 * switched to per-turn `effort==='low'` detection, which turned out to be a
 * misread of the actual signal. This version restores global detection with a
 * short TTL between reads (below) so live edits still propagate in about a
 * second without a restart.
 */

const FAST_MULTIPLIER_OVERRIDES: Record<string, number> = {
  'gpt-5.5': 2.5,
  'gpt-5.4': 2,
  'gpt-5.3-codex': 2,
};
const DEFAULT_FAST_MULTIPLIER = 2;

function normalizeCodexModelKey(model: string): string {
  return model.replace(/^openai\//, '').replace(/-\d{8}$/, '');
}

/**
 * Pure parser, ported from ccusage's `codex_config_requests_fast_service_tier`.
 * A config requests the fast tier iff some line sets `service_tier` (exact key,
 * comments stripped, quotes trimmed) to `"fast"` or `"priority"`.
 * `service_tier_override = "fast"` / `"breakfast"` / `"standard"` must NOT match.
 */
export function codexConfigRequestsFastTier(content: string): boolean {
  for (const rawLine of content.split(/\r?\n/)) {
    const setting = (rawLine.split('#')[0] ?? '').trim();
    const eq = setting.indexOf('=');
    if (eq === -1) continue;
    const key = setting.slice(0, eq).trim();
    if (key !== 'service_tier') continue;
    const value = setting
      .slice(eq + 1)
      .trim()
      .replace(/^['"]+|['"]+$/g, '');
    if (value === 'fast' || value === 'priority') return true;
  }
  return false;
}

function codexHomePaths(): string[] {
  const homes: string[] = [];
  if (process.env.CODEX_HOME) homes.push(process.env.CODEX_HOME);
  homes.push(path.join(os.homedir(), '.codex'));
  return Array.from(new Set(homes));
}

// This sits on the per-RECORD cost path: costOfRecord -> codexFastMultiplier
// -> here, once for every Codex assistant record in every aggregation loop. An
// uncached readFileSync made one codex/all overview render do ~20k synchronous
// reads of config.toml — 1.4s of the render, 12x the claude-only render, paid
// again on every request. One second of TTL keeps a live config.toml edit
// propagating within a second (the reason the v1.4.x rewrite dropped the boot
// cache) at one read per window instead of one per record.
const TIER_TTL_MS = 1000;
let tierCache: { at: number; value: boolean } | null = null;

/** Test hook: drop the TTL window so the next call re-reads config.toml. */
export function invalidateCodexTierCache(): void {
  tierCache = null;
}

/**
 * Whether the active Codex config currently requests the fast / priority
 * service tier. Re-reads config.toml at most once per TIER_TTL_MS, so editing
 * the file takes effect within about a second, no restart needed.
 */
export function detectCodexFastTier(): boolean {
  const now = Date.now();
  if (tierCache && now - tierCache.at < TIER_TTL_MS) return tierCache.value;
  let value = false;
  for (const home of codexHomePaths()) {
    try {
      const content = readFileSync(path.join(home, 'config.toml'), 'utf8');
      if (codexConfigRequestsFastTier(content)) {
        value = true;
        break;
      }
    } catch {
      // missing / unreadable config.toml → not on the fast tier
    }
  }
  tierCache = { at: now, value };
  return value;
}

/** Per-model multiplier when fast tier is active, else 1. */
export function codexFastMultiplier(model: string): number {
  if (!detectCodexFastTier()) return 1;
  return FAST_MULTIPLIER_OVERRIDES[normalizeCodexModelKey(model)] ?? DEFAULT_FAST_MULTIPLIER;
}

/** Scales every per-token rate by `m` so the whole Codex cost (and savings) scales uniformly. */
export function scaleCodexPricing(pricing: Pricing, m: number): Pricing {
  if (m === 1) return pricing;
  return {
    input: pricing.input * m,
    output: pricing.output * m,
    cacheRead: pricing.cacheRead * m,
    cacheCreation5m: pricing.cacheCreation5m * m,
    cacheCreation1h: pricing.cacheCreation1h * m,
  };
}
