// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Source: BerriAI/litellm model_prices_and_context_window.json
// Regenerate: pnpm update-pricing
// Per-1M-token USD pricing in ccgauge's Pricing shape. cacheCreation1h is derived
// as 2x input for Anthropic (LiteLLM only exposes the 5m write cost); OpenAI has no
// cache-write cost so both cache-creation tiers are 0. 200k+ tiers are intentionally
// dropped (ccgauge's Pricing shape does not model them).

import type { Pricing } from '../types';

export declare const LITELLM_CLAUDE_PRICING: Record<string, Pricing>;
export declare const LITELLM_OPENAI_PRICING: Record<string, Pricing>;
