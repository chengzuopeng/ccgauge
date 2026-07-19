import type { Pricing } from '../types';

export declare function isValidPricing(p: unknown): p is Pricing;

export declare function validatePricingTables(
  claude: Record<string, Pricing> | null | undefined,
  openai: Record<string, Pricing> | null | undefined,
  opts?: { minClaude?: number; minOpenai?: number },
): string | null;

export declare function mergeOverlay(
  base: Record<string, Pricing>,
  overlay: Record<string, Pricing> | null | undefined,
): Record<string, Pricing>;

export declare function buildFallback(
  map: Record<string, Pricing>,
  anchors: Record<string, string>,
): Record<string, Pricing>;
