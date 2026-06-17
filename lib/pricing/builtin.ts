import type { Pricing } from '../types';
import { LITELLM_CLAUDE_PRICING } from './litellm-pricing.generated.js';

/**
 * Hand-maintained Claude pricing for the few models LiteLLM's table does NOT
 * carry (verified absent from the generated snapshot): legacy bare names that
 * ccgauge's normalized keys / older logs may use. LiteLLM wins for every model
 * it covers — the snapshot is spread LAST — so this layer only fills gaps.
 *
 * Everything else (fable-5, opus-4-x, sonnet-4-x, haiku-4-5, …) comes from
 * `litellm-pricing.generated.ts`. Refresh it with `pnpm update-pricing`.
 */
const HAND_CLAUDE: Record<string, Pricing> = {
  'claude-opus-4': { input: 15, output: 75, cacheCreation5m: 18.75, cacheCreation1h: 30, cacheRead: 1.5 },
  'claude-sonnet-4': { input: 3, output: 15, cacheCreation5m: 3.75, cacheCreation1h: 6, cacheRead: 0.3 },
  'claude-sonnet-3-7': { input: 3, output: 15, cacheCreation5m: 3.75, cacheCreation1h: 6, cacheRead: 0.3 },
  'claude-haiku-3-5': { input: 0.8, output: 4, cacheCreation5m: 1, cacheCreation1h: 1.6, cacheRead: 0.08 },
  'claude-haiku-3': { input: 0.25, output: 1.25, cacheCreation5m: 0.3, cacheCreation1h: 0.5, cacheRead: 0.03 },
};

export const BUILTIN_PRICING: Record<string, Pricing> = {
  ...HAND_CLAUDE,
  ...LITELLM_CLAUDE_PRICING,
};

export const FALLBACK_BY_FAMILY: Record<string, Pricing> = {
  fable: BUILTIN_PRICING['claude-fable-5'],
  opus: BUILTIN_PRICING['claude-opus-4-8'],
  sonnet: BUILTIN_PRICING['claude-sonnet-4-6'],
  haiku: BUILTIN_PRICING['claude-haiku-4-5'],
};
