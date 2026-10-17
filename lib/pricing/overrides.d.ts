import type { Pricing } from '../types';

export interface ModelOverrides {
  aliases: Map<string, string>;
  prices: Map<string, Pricing>;
  warnings: string[];
}

export declare function overridesPath(): string;
export declare function parseModelOverrides(text: string): ModelOverrides;
export declare function loadModelOverrides(): ModelOverrides;
export declare function invalidateModelOverridesCache(): void;
