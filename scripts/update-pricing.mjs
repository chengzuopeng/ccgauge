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
 * The generated module is committed — it IS the pinned OFFLINE snapshot (the base
 * layer, always present even with no network). At runtime, `lib/pricing/store.ts`
 * can additionally fetch the same table and overlay a fresher copy on disk; the
 * filter + transform math is shared via `lib/pricing/litellm-transform.js` so this
 * script and the runtime fetcher never drift. Re-run this manually to bump the
 * committed base:
 *
 *     pnpm update-pricing
 *
 * Emitted as a plain `.js` module + a `.d.ts` (rather than `.ts`): an explicit
 * `.js` specifier resolves cleanly in every consumer — Next, esbuild, tsc, AND
 * raw `node --experimental-strip-types` test runs (which can't resolve
 * extensionless / `.ts` value imports).
 *
 * Mapping (LiteLLM → ccgauge Pricing, per 1M tokens) lives in litellm-transform.js.
 * `*_above_200k` tiers are dropped — ccgauge's Pricing shape doesn't model them yet.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LITELLM_URL, transformLiteLLMTable } from '../lib/pricing/litellm-transform.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_JS = join(root, 'lib/pricing/litellm-pricing.generated.js');
const OUT_DTS = join(root, 'lib/pricing/litellm-pricing.generated.d.ts');

function renderRecord(record) {
  // Stable, scannable formatting; quoted keys are valid TS.
  return JSON.stringify(record, null, 2);
}

async function main() {
  process.stdout.write(`Fetching LiteLLM pricing…\n  ${LITELLM_URL}\n`);
  const res = await fetch(LITELLM_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching LiteLLM pricing`);
  const raw = await res.json();

  const { claude: claudeSorted, openai: openaiSorted } = transformLiteLLMTable(raw);

  const header = `// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Source: BerriAI/litellm model_prices_and_context_window.json
// Regenerate: pnpm update-pricing
// Per-1M-token USD pricing in ccgauge's Pricing shape. cacheCreation1h is derived
// as 2x input for Anthropic (LiteLLM only exposes the 5m write cost); OpenAI has no
// cache-write cost so both cache-creation tiers are 0. 200k+ tiers are intentionally
// dropped (ccgauge's Pricing shape does not model them).
`;

  const js = `${header}
export const LITELLM_CLAUDE_PRICING = ${renderRecord(claudeSorted)};

export const LITELLM_OPENAI_PRICING = ${renderRecord(openaiSorted)};
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
