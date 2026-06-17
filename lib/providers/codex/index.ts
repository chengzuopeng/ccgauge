import path from 'node:path';
import os from 'node:os';
import { costFromUsage } from '@/lib/pricing/cost-from-usage';
import type { AssistantRecord, CostBreakdown, Pricing } from '@/lib/types';
import { parseCodexJsonlFile } from './parse-codex-jsonl';
import { resolveCodexPricing } from './pricing';
import { shortenCodexModel } from './shorten-model';
import { codexFastMultiplier, scaleCodexPricing } from './speed';
import type { ProviderAdapter } from '../types';

function getDirs(): string[] {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.codex', 'sessions'),
    path.join(home, '.codex', 'archived_sessions'),
  ];
  if (process.env.CCGAUGE_CODEX_DIR) {
    candidates.push(process.env.CCGAUGE_CODEX_DIR);
  }
  if (process.env.CODEX_HOME) {
    candidates.push(path.join(process.env.CODEX_HOME, 'sessions'));
    candidates.push(path.join(process.env.CODEX_HOME, 'archived_sessions'));
  }
  return Array.from(new Set(candidates));
}

/**
 * Codex cost = standard per-token cost × the model's fast/priority-tier
 * multiplier. Scaling the resolved pricing (rather than the final total) keeps
 * every breakdown line — input, output, cache read, savings — consistent under
 * the tier, matching ccusage's whole-cost multiplier.
 */
function codexCostFromUsage(
  usage: AssistantRecord['usage'],
  pricing: Pricing | null,
  model?: string,
): CostBreakdown {
  if (!pricing) return costFromUsage(usage, null);
  return costFromUsage(usage, scaleCodexPricing(pricing, codexFastMultiplier(model ?? '')));
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  displayName: { en: 'Codex', zh: 'Codex' },
  shortLabel: 'X',
  color: { fg: '#047857', bg: '#d1fae5' },
  logoSrc: '/codex-logo.webp',

  parserVersion: 'codex-v6-output-excludes-readded-reasoning',
  capabilities: {
    hasCacheCreation: false,
    hasReasoningTokens: true,
    blockWindowMs: 5 * 60 * 60 * 1000,
  },
  getDirs,
  shouldSkipDir: () => false,
  parseFile: parseCodexJsonlFile,
  resolvePricing: resolveCodexPricing,
  shortenModel: shortenCodexModel,
  costFromUsage: codexCostFromUsage,
  costFootnoteKey: 'cost.footnote.codex',
};
