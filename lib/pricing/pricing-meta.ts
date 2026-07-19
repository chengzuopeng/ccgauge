// Pure type module for pricing metadata — no node:fs, safe to import from client
// components (the refresh button). Keeping these types out of store.ts stops the
// client bundle from pulling store.ts (and its node:fs imports) into the browser
// graph via a `import type` that the bundler doesn't always erase.

export type PricingSource = 'builtin' | 'cache';

export interface PricingMeta {
  source: PricingSource;
  fetchedAt: string | null;
  claudeCount: number;
  openaiCount: number;
  offline: boolean;
}

export type RefreshStatus = 'refreshed' | 'fresh' | 'offline' | 'error';

export interface RefreshResult {
  status: RefreshStatus;
  message?: string;
  meta: PricingMeta;
}
