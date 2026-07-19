import type { Pricing } from '../types';

export declare const LITELLM_URL: string;
export declare const SKIP_MODES: Set<string>;

export declare function transformEntry(entry: Record<string, unknown>): Pricing;
export declare function keepModel(
  name: string,
  entry: Record<string, unknown> | null | undefined,
): boolean;
export declare function transformLiteLLMTable(raw: unknown): {
  claude: Record<string, Pricing>;
  openai: Record<string, Pricing>;
};
