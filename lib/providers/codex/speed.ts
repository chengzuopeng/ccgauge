import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Pricing } from '@/lib/types';

/**
 * Codex "fast" / "priority" service tier handling.
 *
 * OpenAI's Codex CLI can run under a priority service tier (configured as
 * `service_tier = "fast"` or `"priority"` in `~/.codex/config.toml`). On that
 * tier OpenAI bills every token at roughly 2x the standard rate. ccusage
 * models this with a per-pricing `fast_multiplier` (defaulting to 2.0) that is
 * applied to the WHOLE Codex cost — see ccusage's
 * `adapter/codex/speed.rs` + `report.rs::calculate_codex_model_cost`.
 *
 * The multiplier is per-model (ccusage's `fast-multiplier-overrides.json` plus
 * a 2.0 default), applied only when the active Codex config requests the
 * fast/priority tier — otherwise it is 1x. Detection is intentionally
 * conservative: anything other than an explicit `service_tier = fast|priority`
 * leaves cost unchanged.
 */

// Ported from ccusage's `fast-multiplier-overrides.json` ("exact" OpenAI
// entries). Models without an entry fall back to DEFAULT_FAST_MULTIPLIER —
// mirroring ccusage, where a model with no explicit `fast_multiplier` uses 2.0.
const FAST_MULTIPLIER_OVERRIDES: Record<string, number> = {
  'gpt-5.5': 2.5,
  'gpt-5.4': 2,
  'gpt-5.3-codex': 2,
};
const DEFAULT_FAST_MULTIPLIER = 2;

/** Strips an `openai/` prefix and a trailing `-YYYYMMDD`, mirroring resolveCodexPricing. */
function normalizeCodexModelKey(model: string): string {
  return model.replace(/^openai\//, '').replace(/-\d{8}$/, '');
}

/**
 * Pure check, ported verbatim from ccusage's
 * `codex_config_requests_fast_service_tier`: a config requests the fast tier
 * iff some line sets `service_tier` (exact key, comments stripped) to `fast`
 * or `priority`. `service_tier_override` / `"breakfast"` / `"standard"` must
 * NOT match.
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

function computeCodexFastTier(): boolean {
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

let fastTierCache: boolean | undefined;

/** Whether the active Codex config requests the fast/priority service tier. Memoized. */
export function detectCodexFastTier(): boolean {
  if (fastTierCache === undefined) fastTierCache = computeCodexFastTier();
  return fastTierCache;
}

/** Clears the memoized fast-tier detection. Test-only. */
export function __resetCodexFastTierCacheForTest(): void {
  fastTierCache = undefined;
}

/**
 * The cost multiplier for `model`: 1 when the fast/priority tier is inactive,
 * otherwise the model's override (e.g. gpt-5.5 → 2.5) or 2 by default.
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
