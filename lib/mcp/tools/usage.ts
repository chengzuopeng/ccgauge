import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  granularitySchema,
  rangeArgsSchema,
  sourceArgs,
  type SourceArg,
} from '../schema';
import { getMcpIndexerReady, parseDateRange } from '../context';
import {
  modelEntries,
  projectEntries,
  sessionEntries,
  timeBuckets,
  totalsWithBySource,
} from '../formatters';
import { asTextResult } from '../text-result';
import { safeMcpHandler } from '../safe-handler';
import { getProvider } from '@/lib/providers';
import { costFromUsage } from '@/lib/pricing/cost-from-usage';

export function registerUsageTools(server: McpServer): void {

  server.registerTool(
    'usage_summary',
    {
      title: 'Usage summary',
      description:
        'Total tokens and dollar-equivalent cost for a date range. When source="all" (default), the response includes a per-source breakdown alongside combined totals so the LLM can answer either provider-specific or combined questions in a single call.',
      inputSchema: {
        ...rangeArgsSchema,
        ...sourceArgs,
      },
    },
    safeMcpHandler(async (args) => {
      const idx = await getMcpIndexerReady();
      const snap = idx.getSnapshot();
      const ctx = { users: snap.userRecords, parentMap: snap.parentMap };
      const range = parseDateRange(args);
      const source = (args.source ?? 'all') as SourceArg;
      const result = totalsWithBySource(snap.records, source, {
        from: range.from,
        to: range.to,
      }, ctx);
      return asTextResult({
        range_label: range.label,
        from: range.from?.toISOString(),
        to: range.to?.toISOString(),
        source,
        ...result,
      });
    }),
  );

  server.registerTool(
    'usage_by_time',
    {
      title: 'Usage by time',
      description:
        'Time-series of usage and cost, bucketed by hour/day/week/month. Useful for "draw me a trend" or "when does usage spike" questions. Each bucket carries combined totals plus a bySource map (for source="all").',
      inputSchema: {
        ...rangeArgsSchema,
        ...sourceArgs,
        granularity: granularitySchema.describe('hour | day | week | month (default: day)'),
      },
    },
    safeMcpHandler(async (args) => {
      const idx = await getMcpIndexerReady();
      const snap = idx.getSnapshot();
      const ctx = { users: snap.userRecords, parentMap: snap.parentMap };
      const range = parseDateRange(args);
      const source = (args.source ?? 'all') as SourceArg;
      const granularity = args.granularity ?? 'day';
      const buckets = timeBuckets(snap.records, source, granularity, {
        from: range.from,
        to: range.to,
      }, ctx);
      return asTextResult({
        range_label: range.label,
        from: range.from?.toISOString(),
        to: range.to?.toISOString(),
        source,
        granularity,
        bucket_count: buckets.length,
        buckets,
      });
    }),
  );

  server.registerTool(
    'usage_by_model',
    {
      title: 'Usage by model',
      description:
        'Per-model usage and cost for a date range. Each entry carries its `source` so you can group by provider client-side. Sorted by cost desc.',
      inputSchema: {
        ...rangeArgsSchema,
        ...sourceArgs,
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe('Cap to top N entries by cost. Default 20.'),
      },
    },
    safeMcpHandler(async (args) => {
      const idx = await getMcpIndexerReady();
      const snap = idx.getSnapshot();
      const ctx = { users: snap.userRecords, parentMap: snap.parentMap };
      const range = parseDateRange(args);
      const source = (args.source ?? 'all') as SourceArg;
      const limit = args.limit ?? 20;
      let entries = modelEntries(snap.records, source, {
        from: range.from,
        to: range.to,
      }, ctx);
      entries = entries.slice(0, limit);
      return asTextResult({
        range_label: range.label,
        source,
        count: entries.length,
        models: entries,
      });
    }),
  );

  server.registerTool(
    'usage_by_project',
    {
      title: 'Usage by project',
      description:
        'Per-project (working directory) usage and cost. Useful for answering "which project is eating my budget" or "what have I worked on this month". Sorted by cost desc.',
      inputSchema: {
        ...rangeArgsSchema,
        ...sourceArgs,
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Cap to top N projects by cost. Default 20.'),
      },
    },
    safeMcpHandler(async (args) => {
      const idx = await getMcpIndexerReady();
      const snap = idx.getSnapshot();
      const ctx = { users: snap.userRecords, parentMap: snap.parentMap };
      const range = parseDateRange(args);
      const source = (args.source ?? 'all') as SourceArg;
      const limit = args.limit ?? 20;
      let entries = projectEntries(snap.records, source, {
        from: range.from,
        to: range.to,
      }, ctx);
      entries = entries.slice(0, limit);
      return asTextResult({
        range_label: range.label,
        source,
        count: entries.length,
        projects: entries,
      });
    }),
  );

  server.registerTool(
    'usage_by_session',
    {
      title: 'Usage by session',
      description:
        'Per-session list with each session\'s first user message (as title), models used, duration, tokens and cost. Default sort is most-recent first; use `sort` to switch.',
      inputSchema: {
        ...rangeArgsSchema,
        ...sourceArgs,
        sort: z
          .enum(['recent', 'cost', 'tokens', 'duration'])
          .default('recent')
          .describe('recent (default) | cost | tokens | duration. Always desc.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(25)
          .describe('Max sessions to return. Default 25.'),
      },
    },
    safeMcpHandler(async (args) => {
      const idx = await getMcpIndexerReady();
      const snap = idx.getSnapshot();
      const ctx = { users: snap.userRecords, parentMap: snap.parentMap };
      const range = parseDateRange(args);
      const source = (args.source ?? 'all') as SourceArg;
      const sort = args.sort ?? 'recent';
      const limit = args.limit ?? 25;
      let entries = sessionEntries(snap.records, snap.userRecords, source, {
        from: range.from,
        to: range.to,
      }, ctx);
      switch (sort) {
        case 'cost':
          entries.sort((a, b) => b.cost_usd - a.cost_usd);
          break;
        case 'tokens':
          entries.sort((a, b) => b.total_tokens - a.total_tokens);
          break;
        case 'duration':
          entries.sort((a, b) => b.duration_ms - a.duration_ms);
          break;
        case 'recent':
        default:
          entries.sort((a, b) => b.end_time.localeCompare(a.end_time));
      }
      const total = entries.length;
      entries = entries.slice(0, limit);
      return asTextResult({
        range_label: range.label,
        source,
        sort,
        total_count: total,
        returned_count: entries.length,
        sessions: entries,
      });
    }),
  );

  server.registerTool(
    'cost_estimator',
    {
      title: 'Cost estimator',
      description:
        'Compute the dollar-equivalent cost of a hypothetical request given token counts. Uses the provider\'s built-in per-1M-token pricing table; does NOT consult the user\'s usage history. Useful for "how much would 5M output tokens of opus 4.8 cost" / pre-purchase what-ifs. NOTE: reasoning tokens (Codex / OpenAI o-series) are already included in `output_tokens` and billed at the output rate — don\'t double-count them.',
      inputSchema: {
        source: z
          .enum(['claude', 'codex'])
          .describe('claude | codex — pick the pricing namespace.'),
        model: z
          .string()
          .min(1)
          .describe('Exact model id (e.g. "claude-opus-4-8-20260115", "gpt-5.2-codex"). Date suffixes are stripped automatically.'),
        input_tokens: z.number().int().min(0).default(0),
        output_tokens: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe(
            'Total output tokens. INCLUDES reasoning tokens for Codex / o-series — those are billed at the output rate, not separately.',
          ),
        cache_read_tokens: z.number().int().min(0).default(0),
        cache_creation_tokens: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Sum of 5m + 1h cache writes (Anthropic) or 0 (OpenAI).'),
      },
    },
    safeMcpHandler(async (args) => {
      const source = args.source;
      const provider = getProvider(source);
      const { pricing, matchType } = provider.resolvePricing(args.model);

      const usage = {
        input_tokens: args.input_tokens ?? 0,
        output_tokens: args.output_tokens ?? 0,
        cache_creation_input_tokens: args.cache_creation_tokens ?? 0,
        cache_read_input_tokens: args.cache_read_tokens ?? 0,
        cache_creation_5m: 0,
        cache_creation_1h: 0,
      };
      const breakdown = costFromUsage(usage, pricing);
      return asTextResult({
        source,
        model: args.model,
        pricing_match: matchType,
        pricing_resolved:
          matchType === 'exact' ||
          matchType === 'date-stripped' ||
          matchType === 'prefix-stripped',
        pricing,
        usage,
        cost_breakdown: {
          input: breakdown.input,
          output: breakdown.output,
          cache_creation: breakdown.cacheCreation5m + breakdown.cacheCreation1h,
          cache_read: breakdown.cacheRead,
          total: breakdown.total,
          saved_vs_full_input: breakdown.saved,
        },
        total_tokens:
          usage.input_tokens +
          usage.output_tokens +
          usage.cache_read_input_tokens +
          usage.cache_creation_input_tokens,
      });
    }),
  );
}
