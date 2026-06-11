import path from 'node:path';
import os from 'node:os';
import { parseJsonlFile } from '@/lib/data-loader/parse-jsonl';
import { BUILTIN_PRICING, FALLBACK_BY_FAMILY } from '@/lib/pricing/builtin';
import { costFromUsage } from '@/lib/pricing/cost-from-usage';
import { shortenClaudeModel } from './shorten-model';
import type { ProviderAdapter, PricingResolution } from '../types';

const dateSuffix = /-\d{8}$/;
const prefixRe = /^(vertex_ai|bedrock|anthropic)\//;

function resolvePricing(model: string): PricingResolution {
  if (!model) return { pricing: null, matchType: 'none', matchedKey: null };
  if (BUILTIN_PRICING[model]) {
    return { pricing: BUILTIN_PRICING[model], matchType: 'exact', matchedKey: model };
  }
  const stripped = model.replace(dateSuffix, '');
  if (BUILTIN_PRICING[stripped]) {
    return {
      pricing: BUILTIN_PRICING[stripped],
      matchType: 'date-stripped',
      matchedKey: stripped,
    };
  }
  const noPrefix = stripped.replace(prefixRe, '');
  if (BUILTIN_PRICING[noPrefix]) {
    return {
      pricing: BUILTIN_PRICING[noPrefix],
      matchType: 'prefix-stripped',
      matchedKey: noPrefix,
    };
  }
  for (const family of ['fable', 'opus', 'sonnet', 'haiku']) {
    if (model.toLowerCase().includes(family)) {
      return {
        pricing: FALLBACK_BY_FAMILY[family],
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

  parserVersion: 'claude-v4-sidechain-merge',
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
