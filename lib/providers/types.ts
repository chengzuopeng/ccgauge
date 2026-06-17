import type { AssistantRecord, CostBreakdown, Pricing, UserRecord } from '../types';

export type ProviderId = 'claude' | 'codex';

export interface ProviderCapabilities {
  hasCacheCreation: boolean;
  hasReasoningTokens: boolean;
  blockWindowMs: number;
}

export type PricingMatchType =
  | 'exact'
  | 'date-stripped'
  | 'prefix-stripped'
  | 'family-fallback'
  | 'none';

export interface PricingResolution {
  pricing: Pricing | null;
  matchType: PricingMatchType;
  matchedKey: string | null;
}

export interface ParsedFile {
  assistant: AssistantRecord[];
  user: UserRecord[];
  parentLinks: Array<[string, string | null]>;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: { en: string; zh: string };
  shortLabel: string;
  color: { fg: string; bg: string };

  logoSrc: string;
  capabilities: ProviderCapabilities;

  parserVersion: string;

  getDirs(): string[];
  shouldSkipDir(name: string): boolean;
  parseFile(file: string): Promise<ParsedFile>;

  resolvePricing(model: string): PricingResolution;
  shortenModel(model: string): string;
  // `model` lets a provider apply model-specific cost adjustments (e.g. Codex's
  // per-model fast/priority-tier multiplier). Providers that don't need it ignore it.
  costFromUsage(
    usage: AssistantRecord['usage'],
    pricing: Pricing | null,
    model?: string,
  ): CostBreakdown;

  costFootnoteKey: string | null;
}
