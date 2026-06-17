// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Source: BerriAI/litellm model_prices_and_context_window.json
// Regenerate: pnpm update-pricing
// Per-1M-token USD pricing in ccgauge's Pricing shape. cacheCreation1h is derived
// as 2x input for Anthropic (LiteLLM only exposes the 5m write cost); OpenAI has no
// cache-write cost so both cache-creation tiers are 0. 200k+ tiers are intentionally
// dropped (ccgauge's Pricing shape does not model them).

export const LITELLM_CLAUDE_PRICING = {
  "claude-3-7-sonnet-20250219": {
    "input": 3,
    "output": 15,
    "cacheCreation5m": 3.75,
    "cacheCreation1h": 6,
    "cacheRead": 0.3
  },
  "claude-3-haiku-20240307": {
    "input": 0.25,
    "output": 1.25,
    "cacheCreation5m": 0.3,
    "cacheCreation1h": 0.5,
    "cacheRead": 0.03
  },
  "claude-3-opus-20240229": {
    "input": 15,
    "output": 75,
    "cacheCreation5m": 18.75,
    "cacheCreation1h": 30,
    "cacheRead": 1.5
  },
  "claude-4-opus-20250514": {
    "input": 15,
    "output": 75,
    "cacheCreation5m": 18.75,
    "cacheCreation1h": 30,
    "cacheRead": 1.5
  },
  "claude-4-sonnet-20250514": {
    "input": 3,
    "output": 15,
    "cacheCreation5m": 3.75,
    "cacheCreation1h": 6,
    "cacheRead": 0.3
  },
  "claude-fable-5": {
    "input": 10,
    "output": 50,
    "cacheCreation5m": 12.5,
    "cacheCreation1h": 20,
    "cacheRead": 1
  },
  "claude-haiku-4-5": {
    "input": 1,
    "output": 5,
    "cacheCreation5m": 1.25,
    "cacheCreation1h": 2,
    "cacheRead": 0.1
  },
  "claude-haiku-4-5-20251001": {
    "input": 1,
    "output": 5,
    "cacheCreation5m": 1.25,
    "cacheCreation1h": 2,
    "cacheRead": 0.1
  },
  "claude-opus-4-1": {
    "input": 15,
    "output": 75,
    "cacheCreation5m": 18.75,
    "cacheCreation1h": 30,
    "cacheRead": 1.5
  },
  "claude-opus-4-1-20250805": {
    "input": 15,
    "output": 75,
    "cacheCreation5m": 18.75,
    "cacheCreation1h": 30,
    "cacheRead": 1.5
  },
  "claude-opus-4-20250514": {
    "input": 15,
    "output": 75,
    "cacheCreation5m": 18.75,
    "cacheCreation1h": 30,
    "cacheRead": 1.5
  },
  "claude-opus-4-5": {
    "input": 5,
    "output": 25,
    "cacheCreation5m": 6.25,
    "cacheCreation1h": 10,
    "cacheRead": 0.5
  },
  "claude-opus-4-5-20251101": {
    "input": 5,
    "output": 25,
    "cacheCreation5m": 6.25,
    "cacheCreation1h": 10,
    "cacheRead": 0.5
  },
  "claude-opus-4-6": {
    "input": 5,
    "output": 25,
    "cacheCreation5m": 6.25,
    "cacheCreation1h": 10,
    "cacheRead": 0.5
  },
  "claude-opus-4-6-20260205": {
    "input": 5,
    "output": 25,
    "cacheCreation5m": 6.25,
    "cacheCreation1h": 10,
    "cacheRead": 0.5
  },
  "claude-opus-4-7": {
    "input": 5,
    "output": 25,
    "cacheCreation5m": 6.25,
    "cacheCreation1h": 10,
    "cacheRead": 0.5
  },
  "claude-opus-4-7-20260416": {
    "input": 5,
    "output": 25,
    "cacheCreation5m": 6.25,
    "cacheCreation1h": 10,
    "cacheRead": 0.5
  },
  "claude-opus-4-8": {
    "input": 5,
    "output": 25,
    "cacheCreation5m": 6.25,
    "cacheCreation1h": 10,
    "cacheRead": 0.5
  },
  "claude-sonnet-4-20250514": {
    "input": 3,
    "output": 15,
    "cacheCreation5m": 3.75,
    "cacheCreation1h": 6,
    "cacheRead": 0.3
  },
  "claude-sonnet-4-5": {
    "input": 3,
    "output": 15,
    "cacheCreation5m": 3.75,
    "cacheCreation1h": 6,
    "cacheRead": 0.3
  },
  "claude-sonnet-4-5-20250929": {
    "input": 3,
    "output": 15,
    "cacheCreation5m": 3.75,
    "cacheCreation1h": 6,
    "cacheRead": 0.3
  },
  "claude-sonnet-4-6": {
    "input": 3,
    "output": 15,
    "cacheCreation5m": 3.75,
    "cacheCreation1h": 6,
    "cacheRead": 0.3
  }
};

export const LITELLM_OPENAI_PRICING = {
  "chatgpt-4o-latest": {
    "input": 5,
    "output": 15,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "codex-mini-latest": {
    "input": 1.5,
    "output": 6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.375
  },
  "gpt-3.5-turbo": {
    "input": 0.5,
    "output": 1.5,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.05
  },
  "gpt-3.5-turbo-0125": {
    "input": 0.5,
    "output": 1.5,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.05
  },
  "gpt-3.5-turbo-1106": {
    "input": 1,
    "output": 2,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.1
  },
  "gpt-3.5-turbo-16k": {
    "input": 3,
    "output": 4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.3
  },
  "gpt-4": {
    "input": 30,
    "output": 60,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 3
  },
  "gpt-4-0125-preview": {
    "input": 10,
    "output": 30,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1
  },
  "gpt-4-0314": {
    "input": 30,
    "output": 60,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 3
  },
  "gpt-4-0613": {
    "input": 30,
    "output": 60,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 3
  },
  "gpt-4-1106-preview": {
    "input": 10,
    "output": 30,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1
  },
  "gpt-4-turbo": {
    "input": 10,
    "output": 30,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1
  },
  "gpt-4-turbo-2024-04-09": {
    "input": 10,
    "output": 30,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1
  },
  "gpt-4-turbo-preview": {
    "input": 10,
    "output": 30,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1
  },
  "gpt-4.1": {
    "input": 2,
    "output": 8,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "gpt-4.1-2025-04-14": {
    "input": 2,
    "output": 8,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "gpt-4.1-mini": {
    "input": 0.4,
    "output": 1.6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.1
  },
  "gpt-4.1-mini-2025-04-14": {
    "input": 0.4,
    "output": 1.6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.1
  },
  "gpt-4.1-nano": {
    "input": 0.1,
    "output": 0.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.025
  },
  "gpt-4.1-nano-2025-04-14": {
    "input": 0.1,
    "output": 0.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.025
  },
  "gpt-4o": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1.25
  },
  "gpt-4o-2024-05-13": {
    "input": 5,
    "output": 15,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "gpt-4o-2024-08-06": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1.25
  },
  "gpt-4o-2024-11-20": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1.25
  },
  "gpt-4o-audio-preview": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.25
  },
  "gpt-4o-audio-preview-2024-12-17": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.25
  },
  "gpt-4o-audio-preview-2025-06-03": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.25
  },
  "gpt-4o-mini": {
    "input": 0.15,
    "output": 0.6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.075
  },
  "gpt-4o-mini-2024-07-18": {
    "input": 0.15,
    "output": 0.6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.075
  },
  "gpt-4o-mini-audio-preview": {
    "input": 0.15,
    "output": 0.6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.015
  },
  "gpt-4o-mini-audio-preview-2024-12-17": {
    "input": 0.15,
    "output": 0.6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.015
  },
  "gpt-4o-mini-realtime-preview": {
    "input": 0.6,
    "output": 2.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.3
  },
  "gpt-4o-mini-realtime-preview-2024-12-17": {
    "input": 0.6,
    "output": 2.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.3
  },
  "gpt-4o-mini-search-preview": {
    "input": 0.15,
    "output": 0.6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.075
  },
  "gpt-4o-mini-search-preview-2025-03-11": {
    "input": 0.15,
    "output": 0.6,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.075
  },
  "gpt-4o-realtime-preview": {
    "input": 5,
    "output": 20,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2.5
  },
  "gpt-4o-realtime-preview-2024-12-17": {
    "input": 5,
    "output": 20,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2.5
  },
  "gpt-4o-realtime-preview-2025-06-03": {
    "input": 5,
    "output": 20,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2.5
  },
  "gpt-4o-search-preview": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1.25
  },
  "gpt-4o-search-preview-2025-03-11": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1.25
  },
  "gpt-5": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5-2025-08-07": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5-chat": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5-chat-latest": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5-codex": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5-mini": {
    "input": 0.25,
    "output": 2,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.025
  },
  "gpt-5-mini-2025-08-07": {
    "input": 0.25,
    "output": 2,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.025
  },
  "gpt-5-nano": {
    "input": 0.05,
    "output": 0.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.005
  },
  "gpt-5-nano-2025-08-07": {
    "input": 0.05,
    "output": 0.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.005
  },
  "gpt-5-pro": {
    "input": 15,
    "output": 120,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1.5
  },
  "gpt-5-pro-2025-10-06": {
    "input": 15,
    "output": 120,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 1.5
  },
  "gpt-5-search-api": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5-search-api-2025-10-14": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5.1": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5.1-2025-11-13": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5.1-chat-latest": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5.1-codex": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5.1-codex-max": {
    "input": 1.25,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.125
  },
  "gpt-5.1-codex-mini": {
    "input": 0.25,
    "output": 2,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.025
  },
  "gpt-5.2": {
    "input": 1.75,
    "output": 14,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.175
  },
  "gpt-5.2-2025-12-11": {
    "input": 1.75,
    "output": 14,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.175
  },
  "gpt-5.2-chat-latest": {
    "input": 1.75,
    "output": 14,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.175
  },
  "gpt-5.2-codex": {
    "input": 1.75,
    "output": 14,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.175
  },
  "gpt-5.2-pro": {
    "input": 21,
    "output": 168,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2.1
  },
  "gpt-5.2-pro-2025-12-11": {
    "input": 21,
    "output": 168,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2.1
  },
  "gpt-5.3-chat-latest": {
    "input": 1.75,
    "output": 14,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.175
  },
  "gpt-5.3-codex": {
    "input": 1.75,
    "output": 14,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.175
  },
  "gpt-5.4": {
    "input": 2.5,
    "output": 15,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.25
  },
  "gpt-5.4-2026-03-05": {
    "input": 2.5,
    "output": 15,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.25
  },
  "gpt-5.4-mini": {
    "input": 0.75,
    "output": 4.5,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.075
  },
  "gpt-5.4-mini-2026-03-17": {
    "input": 0.75,
    "output": 4.5,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.075
  },
  "gpt-5.4-nano": {
    "input": 0.2,
    "output": 1.25,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.02
  },
  "gpt-5.4-nano-2026-03-17": {
    "input": 0.2,
    "output": 1.25,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.02
  },
  "gpt-5.4-pro": {
    "input": 30,
    "output": 180,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 3
  },
  "gpt-5.4-pro-2026-03-05": {
    "input": 30,
    "output": 180,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 3
  },
  "gpt-5.5": {
    "input": 5,
    "output": 30,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "gpt-5.5-2026-04-23": {
    "input": 5,
    "output": 30,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "gpt-5.5-pro": {
    "input": 30,
    "output": 180,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 3
  },
  "gpt-5.5-pro-2026-04-23": {
    "input": 30,
    "output": 180,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 3
  },
  "gpt-audio": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.25
  },
  "gpt-audio-1.5": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.25
  },
  "gpt-audio-2025-08-28": {
    "input": 2.5,
    "output": 10,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.25
  },
  "gpt-audio-mini": {
    "input": 0.6,
    "output": 2.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.06
  },
  "gpt-audio-mini-2025-10-06": {
    "input": 0.6,
    "output": 2.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.06
  },
  "gpt-audio-mini-2025-12-15": {
    "input": 0.6,
    "output": 2.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.06
  },
  "gpt-realtime": {
    "input": 4,
    "output": 16,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.4
  },
  "gpt-realtime-1.5": {
    "input": 4,
    "output": 16,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.4
  },
  "gpt-realtime-2": {
    "input": 4,
    "output": 16,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.4
  },
  "gpt-realtime-2025-08-28": {
    "input": 4,
    "output": 16,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.4
  },
  "gpt-realtime-mini": {
    "input": 0.6,
    "output": 2.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.06
  },
  "gpt-realtime-mini-2025-10-06": {
    "input": 0.6,
    "output": 2.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.06
  },
  "gpt-realtime-mini-2025-12-15": {
    "input": 0.6,
    "output": 2.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.06
  },
  "o1": {
    "input": 15,
    "output": 60,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 7.5
  },
  "o1-2024-12-17": {
    "input": 15,
    "output": 60,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 7.5
  },
  "o1-pro": {
    "input": 150,
    "output": 600,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 15
  },
  "o1-pro-2025-03-19": {
    "input": 150,
    "output": 600,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 15
  },
  "o3": {
    "input": 2,
    "output": 8,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "o3-2025-04-16": {
    "input": 2,
    "output": 8,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "o3-deep-research": {
    "input": 10,
    "output": 40,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2.5
  },
  "o3-deep-research-2025-06-26": {
    "input": 10,
    "output": 40,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2.5
  },
  "o3-mini": {
    "input": 1.1,
    "output": 4.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.55
  },
  "o3-mini-2025-01-31": {
    "input": 1.1,
    "output": 4.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.55
  },
  "o3-pro": {
    "input": 20,
    "output": 80,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2
  },
  "o3-pro-2025-06-10": {
    "input": 20,
    "output": 80,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 2
  },
  "o4-mini": {
    "input": 1.1,
    "output": 4.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.275
  },
  "o4-mini-2025-04-16": {
    "input": 1.1,
    "output": 4.4,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.275
  },
  "o4-mini-deep-research": {
    "input": 2,
    "output": 8,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  },
  "o4-mini-deep-research-2025-06-26": {
    "input": 2,
    "output": 8,
    "cacheCreation5m": 0,
    "cacheCreation1h": 0,
    "cacheRead": 0.5
  }
};
