import type { Pricing } from '../types';

export declare function isOpenAIPriorityModel(model: string): boolean;

export declare function nearestKnownVersionKey(
  model: string,
  table: Record<string, Pricing>,
): string | null;
