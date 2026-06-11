import type { Pricing } from '../types';

export const BUILTIN_PRICING: Record<string, Pricing> = {
  'claude-fable-5': {
    input: 10,
    output: 50,
    cacheCreation5m: 12.5,
    cacheCreation1h: 20,
    cacheRead: 1,
  },
  'claude-opus-4-8': {
    input: 5,
    output: 25,
    cacheCreation5m: 6.25,
    cacheCreation1h: 10,
    cacheRead: 0.5,
  },
  'claude-opus-4-7': {
    input: 5,
    output: 25,
    cacheCreation5m: 6.25,
    cacheCreation1h: 10,
    cacheRead: 0.5,
  },
  'claude-opus-4-6': {
    input: 5,
    output: 25,
    cacheCreation5m: 6.25,
    cacheCreation1h: 10,
    cacheRead: 0.5,
  },
  'claude-opus-4-5': {
    input: 5,
    output: 25,
    cacheCreation5m: 6.25,
    cacheCreation1h: 10,
    cacheRead: 0.5,
  },
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cacheCreation5m: 3.75,
    cacheCreation1h: 6,
    cacheRead: 0.3,
  },
  'claude-sonnet-4-5': {
    input: 3,
    output: 15,
    cacheCreation5m: 3.75,
    cacheCreation1h: 6,
    cacheRead: 0.3,
  },
  'claude-haiku-4-5': {
    input: 1,
    output: 5,
    cacheCreation5m: 1.25,
    cacheCreation1h: 2,
    cacheRead: 0.1,
  },
  'claude-haiku-3-5': {
    input: 0.8,
    output: 4,
    cacheCreation5m: 1,
    cacheCreation1h: 1.6,
    cacheRead: 0.08,
  },
  'claude-opus-4-1': {
    input: 15,
    output: 75,
    cacheCreation5m: 18.75,
    cacheCreation1h: 30,
    cacheRead: 1.5,
  },
  'claude-opus-4': {
    input: 15,
    output: 75,
    cacheCreation5m: 18.75,
    cacheCreation1h: 30,
    cacheRead: 1.5,
  },
  'claude-sonnet-4': {
    input: 3,
    output: 15,
    cacheCreation5m: 3.75,
    cacheCreation1h: 6,
    cacheRead: 0.3,
  },
  'claude-sonnet-3-7': {
    input: 3,
    output: 15,
    cacheCreation5m: 3.75,
    cacheCreation1h: 6,
    cacheRead: 0.3,
  },
  'claude-haiku-3': {
    input: 0.25,
    output: 1.25,
    cacheCreation5m: 0.3,
    cacheCreation1h: 0.5,
    cacheRead: 0.03,
  },
};

export const FALLBACK_BY_FAMILY: Record<string, Pricing> = {
  fable: BUILTIN_PRICING['claude-fable-5'],
  opus: BUILTIN_PRICING['claude-opus-4-8'],
  sonnet: BUILTIN_PRICING['claude-sonnet-4-6'],
  haiku: BUILTIN_PRICING['claude-haiku-4-5'],
};
