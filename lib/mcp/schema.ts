import { z } from 'zod';
import type { ProviderId } from '@/lib/types';
import { isLocalDateOnly, parseDateLike } from '@/lib/date-utils';

export const sourceSchema = z.enum(['claude', 'codex', 'all']).default('all');
export type SourceArg = z.infer<typeof sourceSchema>;

export const granularitySchema = z.enum(['hour', 'day', 'week', 'month']).default('day');
export type GranularityArg = z.infer<typeof granularitySchema>;

function isValidDateString(s: string): boolean {
  return parseDateLike(s) !== null;
}

const dateBoundSchema = z
  .string()
  .refine(isValidDateString, {
    message: 'must be a YYYY-MM-DD date or a full ISO 8601 timestamp',
  });

export const rangeArgsSchema = {
  range: z
    .enum([
      'today',
      'yesterday',
      'this_week',
      'last_week',
      'this_month',
      'last_month',
      '7d',
      '30d',
      '90d',
      'all',
    ])
    .optional()
    .describe('Named time window. Defaults to "all" if no explicit from/to is given.'),
  from: dateBoundSchema
    .optional()
    .describe('Inclusive lower bound (ISO date YYYY-MM-DD or full ISO timestamp).'),
  to: dateBoundSchema
    .optional()
    .describe('Inclusive upper bound (ISO date YYYY-MM-DD or full ISO timestamp).'),
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const SPECIAL_DAYS = ['today', 'yesterday'] as const;
export const daySchema = z
  .string()
  .refine(
    (s) => {
      const lower = s.toLowerCase();
      if ((SPECIAL_DAYS as readonly string[]).includes(lower)) return true;
      if ((WEEKDAYS as readonly string[]).includes(lower)) return true;
      return isLocalDateOnly(s);
    },
    {
      message: 'must be "today", "yesterday", a weekday name (monday..sunday), or YYYY-MM-DD',
    },
  );

export const sourceArgs = {
  source: sourceSchema.describe(
    'claude | codex | all (default). When all, the response carries combined totals plus a bySource breakdown.',
  ),
};

export const PROVIDERS: ProviderId[] = ['claude', 'codex'];
