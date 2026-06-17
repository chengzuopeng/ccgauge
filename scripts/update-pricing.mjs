#!/usr/bin/env node
/**
 * Refresh the built-in pricing snapshot from LiteLLM.
 *
 * ccgauge sources Claude + OpenAI/Codex pricing from LiteLLM's community-maintained
 * `model_prices_and_context_window.json` (the same table ccusage uses), rather than
 * hand-maintaining numbers. This script fetches that table, filters to the Anthropic
 * and OpenAI chat models we care about, converts LiteLLM's per-token costs into
 * ccgauge's per-1M `Pricing` shape, and writes a generated TS module:
 *
 *     lib/pricing/litellm-pricing.generated.ts
 *
 * The generated module is committed — it IS the pinned snapshot. Nothing fetches at
 * build time or runtime (ccgauge stays fully offline). Re-run this manually to bump:
 *
 *     pnpm update-pricing
 *
 * Emitted as a plain `.js` module + a `.d.ts` (rather than `.ts`): an explicit
 * `.js` specifier resolves cleanly in every consumer — Next, esbuild, tsc, AND
 * raw `node --experimental-strip-types` test runs (which can't resolve
 * extensionless / `.ts` value imports).
 *
 * Mapping (LiteLLM → ccgauge Pricing, per 1M tokens):
 *   input            = input_cost_per_token            × 1e6
 *   output           = output_cost_per_token           × 1e6
 *   cacheRead        = (cache_read_input_token_cost ?? input×0.1) × 1e6
 *   cacheCreation5m  = (cache_creation_input_token_cost ?? 0) × 1e6   (Anthropic ≈1.25×input; OpenAI absent → 0)
 *   cacheCreation1h  = cache_creation present ? input(per1M)×2 : 0     (mirrors ccusage's 2× 1h-cache rule)
 * `*_above_200k` tiers are dropped — ccgauge's Pricing shape doesn't model them yet.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_JS = join(root, 'lib/pricing/litellm-pricing.generated.js');
const OUT_DTS = join(root, 'lib/pricing/litellm-pricing.generated.d.ts');

// Modes that aren't chat/completion billing we care about.
const SKIP_MODES = new Set([
  'embedding',
  'image_generation',
  'audio_transcription',
  'audio_speech',
  'moderation',
  'rerank',
]);

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const per1m = (perTok) => round6(perTok * 1e6);

function transform(entry) {
  const input = per1m(entry.input_cost_per_token);
  const output = per1m(entry.output_cost_per_token);
  const hasCacheCreate =
    typeof entry.cache_creation_input_token_cost === 'number';
  const cacheRead = per1m(
    typeof entry.cache_read_input_token_cost === 'number'
      ? entry.cache_read_input_token_cost
      : entry.input_cost_per_token * 0.1,
  );
  const cacheCreation5m = hasCacheCreate
    ? per1m(entry.cache_creation_input_token_cost)
    : 0;
  const cacheCreation1h = hasCacheCreate ? round6(input * 2) : 0;
  return { input, output, cacheCreation5m, cacheCreation1h, cacheRead };
}

function keep(name, entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (name.includes('/')) return false; // skip provider-prefixed aliases (anthropic/…, openai/…, bedrock/…)
  if (name.startsWith('ft:')) return false; // skip fine-tunes
  const provider = entry.litellm_provider;
  if (provider !== 'anthropic' && provider !== 'openai') return false;
  if (typeof entry.input_cost_per_token !== 'number') return false;
  if (typeof entry.output_cost_per_token !== 'number') return false;
  if (entry.mode && SKIP_MODES.has(entry.mode)) return false;
  return true;
}

function sortedObject(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

function renderRecord(name, record) {
  // Stable, scannable formatting; quoted keys are valid TS.
  return JSON.stringify(record, null, 2);
}

async function main() {
  process.stdout.write(`Fetching LiteLLM pricing…\n  ${LITELLM_URL}\n`);
  const res = await fetch(LITELLM_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching LiteLLM pricing`);
  const raw = await res.json();

  const claude = {};
  const openai = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!keep(name, entry)) continue;
    const priced = transform(entry);
    if (name.startsWith('claude')) claude[name] = priced;
    else openai[name] = priced;
  }

  const claudeSorted = sortedObject(claude);
  const openaiSorted = sortedObject(openai);

  const header = `// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Source: BerriAI/litellm model_prices_and_context_window.json
// Regenerate: pnpm update-pricing
// Per-1M-token USD pricing in ccgauge's Pricing shape. cacheCreation1h is derived
// as 2x input for Anthropic (LiteLLM only exposes the 5m write cost); OpenAI has no
// cache-write cost so both cache-creation tiers are 0. 200k+ tiers are intentionally
// dropped (ccgauge's Pricing shape does not model them).
`;

  const js = `${header}
export const LITELLM_CLAUDE_PRICING = ${renderRecord('claude', claudeSorted)};

export const LITELLM_OPENAI_PRICING = ${renderRecord('openai', openaiSorted)};
`;

  const dts = `${header}
import type { Pricing } from '../types';

export declare const LITELLM_CLAUDE_PRICING: Record<string, Pricing>;
export declare const LITELLM_OPENAI_PRICING: Record<string, Pricing>;
`;

  writeFileSync(OUT_JS, js, 'utf8');
  writeFileSync(OUT_DTS, dts, 'utf8');

  process.stdout.write(
    `\nWrote ${OUT_JS}\n   +   ${OUT_DTS}\n  claude models: ${Object.keys(claudeSorted).length}\n  openai models: ${Object.keys(openaiSorted).length}\n`,
  );
  process.stdout.write('\nKey values (sanity):\n');
  for (const m of [
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-fable-5',
    'gpt-5.5',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5-codex',
  ]) {
    const p = claudeSorted[m] ?? openaiSorted[m];
    if (p)
      process.stdout.write(
        `  ${m.padEnd(18)} in/out=${p.input}/${p.output} cc5m=${p.cacheCreation5m} cc1h=${p.cacheCreation1h} cr=${p.cacheRead}\n`,
      );
    else process.stdout.write(`  ${m.padEnd(18)} <absent in LiteLLM>\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
