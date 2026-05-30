import path from 'node:path';
import os from 'node:os';
import { costFromUsage } from '@/lib/pricing/cost-from-usage';
import { parseCodexJsonlFile } from './parse-codex-jsonl';
import { resolveCodexPricing } from './pricing';
import { shortenCodexModel } from './shorten-model';
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

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  displayName: { en: 'Codex', zh: 'Codex' },
  shortLabel: 'X',
  color: { fg: '#047857', bg: '#d1fae5' },
  logoSrc: '/codex-logo.webp',

  parserVersion: 'codex-v5-last-total-prev',
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
  costFromUsage,
  costFootnoteKey: 'cost.footnote.codex',
};
