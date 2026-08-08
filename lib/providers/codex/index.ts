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
 * Codex cost = standard per-token cost × the global fast/priority-tier
 * multiplier. When the active `~/.codex/config.toml` requests
 * `service_tier = "fast" | "priority"`, every record bills at the per-model
 * multiplier (gpt-5.5 → 2.5x, others → 2x). Otherwise everything bills at the
 * standard rate. Mirrors ccusage's `adapter/codex/report.rs` per-report speed.
 */
function codexCostFromUsage(
  usage: AssistantRecord['usage'],
  pricing: Pricing | null,
  model?: string,
): CostBreakdown {
  if (!pricing) return costFromUsage(usage, null);
  const m = codexFastMultiplier(model ?? '');
  return costFromUsage(usage, m === 1 ? pricing : scaleCodexPricing(pricing, m));
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  displayName: { en: 'Codex', zh: 'Codex' },
  shortLabel: 'X',
  color: { fg: '#047857', bg: '#d1fae5' },
  logoSrc: '/codex-logo.webp',

  parserVersion: 'codex-v12-review-spawn-linkage',
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
