// Shared LiteLLM → ccgauge Pricing transform.
//
// Single source of truth for BOTH the build-time snapshot generator
// (`scripts/update-pricing.mjs`) and the runtime fetcher (`lib/pricing/store.ts`).
// Keeping the provider filter + per-token→per-1M math in one module prevents the
// two paths from drifting (e.g. when LiteLLM adds a cache-write cost to a model
// that previously had none, both paths must react identically).
//
// Plain `.js` (native ESM under this repo's `"type": "module"`) with a sibling
// `.d.ts`, mirroring `litellm-pricing.generated.js`: an explicit specifier
// resolves cleanly in Next, esbuild, tsc, AND plain `node scripts/*.mjs`.

export const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

// Modes that aren't chat/completion billing we care about.
export const SKIP_MODES = new Set([
  'embedding',
  'image_generation',
  'audio_transcription',
  'audio_speech',
  'moderation',
  'rerank',
]);

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const per1m = (perTok) => round6(perTok * 1e6);

/**
 * Convert one LiteLLM entry into ccgauge's per-1M `Pricing` shape.
 * cacheCreation1h is derived as 2x input for Anthropic (LiteLLM only exposes the
 * 5m write cost); models with no cache-write cost get 0 for both tiers.
 */
export function transformEntry(entry) {
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

/**
 * Should this LiteLLM model be kept? Filters to Anthropic + OpenAI direct chat
 * models, dropping provider-prefixed aliases, fine-tunes, and non-chat modes.
 */
export function keepModel(name, entry) {
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

/**
 * Transform a full LiteLLM `model_prices_and_context_window.json` object into
 * ccgauge's two sorted pricing tables: `{ claude, openai }`.
 */
export function transformLiteLLMTable(raw) {
  const claude = {};
  const openai = {};
  for (const [name, entry] of Object.entries(raw ?? {})) {
    if (!keepModel(name, entry)) continue;
    const priced = transformEntry(entry);
    if (name.startsWith('claude')) claude[name] = priced;
    else openai[name] = priced;
  }
  return { claude: sortedObject(claude), openai: sortedObject(openai) };
}
