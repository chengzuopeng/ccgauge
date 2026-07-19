import path from 'node:path';
import os from 'node:os';
import { parseJsonlFile } from '@/lib/data-loader/parse-jsonl';
import { BUILTIN_PRICING, FALLBACK_BY_FAMILY } from '@/lib/pricing/builtin';
import { costFromUsage } from '@/lib/pricing/cost-from-usage';
import { shortenClaudeModel } from './shorten-model';
import type { Pricing } from '@/lib/types';
import type { ProviderAdapter, PricingResolution } from '../types';

const dateSuffix = /-\d{8}$/;
const prefixRe = /^(vertex_ai|bedrock|anthropic)\//;

// Runtime overlay published by lib/pricing/store.ts (loose globalThis contract so
// this file never imports the store — see codex/pricing.ts for the rationale).
interface PricingSlotState {
  claude?: Record<string, Pricing>;
  claudeFallback?: Record<string, Pricing>;
}
function slotState(): PricingSlotState | undefined {
  return (
    globalThis as unknown as { __ccgaugePricing?: { state?: PricingSlotState } }
  ).__ccgaugePricing?.state;
}
function activeClaude(): Record<string, Pricing> {
  return slotState()?.claude ?? BUILTIN_PRICING;
}
function activeClaudeFallback(): Record<string, Pricing> {
  return slotState()?.claudeFallback ?? FALLBACK_BY_FAMILY;
}

function resolvePricing(model: string): PricingResolution {
  if (!model) return { pricing: null, matchType: 'none', matchedKey: null };
  const pricing = activeClaude();
  if (pricing[model]) {
    return { pricing: pricing[model], matchType: 'exact', matchedKey: model };
  }
  const stripped = model.replace(dateSuffix, '');
  if (pricing[stripped]) {
    return {
      pricing: pricing[stripped],
      matchType: 'date-stripped',
      matchedKey: stripped,
    };
  }
  const noPrefix = stripped.replace(prefixRe, '');
  if (pricing[noPrefix]) {
    return {
      pricing: pricing[noPrefix],
      matchType: 'prefix-stripped',
      matchedKey: noPrefix,
    };
  }
  const fallback = activeClaudeFallback();
  for (const family of ['fable', 'opus', 'sonnet', 'haiku']) {
    if (model.toLowerCase().includes(family)) {
      return {
        pricing: fallback[family] ?? null,
        matchType: 'family-fallback',
        matchedKey: `claude-${family}-(latest)`,
      };
    }
  }
  return { pricing: null, matchType: 'none', matchedKey: null };
}

function getDirs(): string[] {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.claude', 'projects'),
    path.join(home, '.config', 'claude', 'projects'),
  ];
  if (process.env.CCGAUGE_CONFIG_DIR) {
    candidates.push(path.join(process.env.CCGAUGE_CONFIG_DIR, 'projects'));
  }
  if (process.env.CLAUDE_CONFIG_DIR) {
    candidates.push(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects'));
  }
  return Array.from(new Set(candidates));
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  displayName: { en: 'Claude', zh: 'Claude' },
  shortLabel: 'C',
  color: { fg: '#b45309', bg: '#fef3c7' },
  logoSrc: '/claude-logo.webp',

  parserVersion: 'claude-v5-task-notification-synthetic',
  capabilities: {
    hasCacheCreation: true,
    hasReasoningTokens: false,
    blockWindowMs: 5 * 60 * 60 * 1000,
  },
  getDirs,
  shouldSkipDir: (name) => name === 'tool-results' || name === 'memory',
  parseFile: async (file) => {
    const parsed = await parseJsonlFile(file);
    return parsed;
  },
  resolvePricing,
  shortenModel: shortenClaudeModel,
  costFromUsage,
  costFootnoteKey: null,
};
