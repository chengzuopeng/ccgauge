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
 * misread of the actual signal. This version restores global detection but
 * reads `config.toml` **on every call** so live edits propagate immediately.
 * The cost is one ~few-hundred-byte file read per request — negligible.
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

/**
 * Whether the active Codex config currently requests the fast / priority
 * service tier. Re-reads config.toml on every call — no cache — so editing
 * the file takes effect immediately without restarting the dashboard.
 */
export function detectCodexFastTier(): boolean {
  for (const home of codexHomePaths()) {
    try {
      const content = readFileSync(path.join(home, 'config.toml'), 'utf8');
      if (codexConfigRequestsFastTier(content)) return true;
    } catch {
      // missing / unreadable config.toml → not on the fast tier
    }
  }
  return false;
}

/**
 * Per-model multiplier when fast tier is active, else 1. Caller decides
 * whether to consult `detectCodexFastTier()` to scope the call — the cost
 * path does it once per request and passes the result to many records.
 */
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
