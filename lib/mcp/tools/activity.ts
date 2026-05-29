import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { daySchema, sourceArgs, type SourceArg } from '../schema';
import { getMcpIndexerReady, parseDayArg } from '../context';
import {
  modelEntries,
  projectEntries,
  sessionEntries,
  timeBuckets,
  totalsWithBySource,
  type FlatTotals,
  type FlatSessionEntry,
  type FlatProjectEntry,
  type FlatModelEntry,
} from '../formatters';
import type { AssistantRecord, ProviderId } from '@/lib/types';
import { asTextResult } from '../text-result';
import { safeMcpHandler } from '../safe-handler';

const ZERO_TOTALS_PUBLIC: FlatTotals = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  cost_usd: 0,
  saved_usd: 0,
  requests: 0,
  turns: 0,
};

function weekWindow(offset: number): { from: Date; to: Date; label: string } {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1 + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: monday, to: sunday, label: `${fmt(monday)} → ${fmt(sunday)}` };
}

function groupSessionsByProject(entries: FlatSessionEntry[]) {
  const map = new Map<string, { project: string; cwd: string; sessions: FlatSessionEntry[] }>();
  for (const s of entries) {
    const key = s.cwd || '(unknown)';
    let group = map.get(key);
    if (!group) {
      group = { project: s.project_name, cwd: key, sessions: [] };
      map.set(key, group);
    }
    group.sessions.push(s);
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      b.sessions.reduce((s, x) => s + x.cost_usd, 0) -
      a.sessions.reduce((s, x) => s + x.cost_usd, 0),
  );
}

function topToolUses(
  records: AssistantRecord[],
  windowed: { from: Date; to: Date },
  source: SourceArg,
  limit = 10,
) {
  const fromIso = windowed.from.toISOString();
  const toIso = windowed.to.toISOString();
  const counts = new Map<string, number>();
  for (const r of records) {
    if (source !== 'all' && r.source !== source) continue;
    if (r.timestamp < fromIso) continue;
    if (r.timestamp > toIso) continue;
    for (const t of r.toolNames) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tool, count]) => ({ tool, count }));
}

export function registerActivityTools(server: McpServer): void {

  server.registerTool(
    'daily_summary',
    {
      title: 'Daily summary — what was worked on',
      description:
        'A "what did I do" report for a single day. Returns totals, sessions grouped by project (with first-user-message titles), models used, and top tool calls. Date defaults to "today" and accepts "yesterday", weekday names ("monday"..), or YYYY-MM-DD.',
      inputSchema: {
        date: daySchema
          .optional()
          .describe('today | yesterday | monday..sunday | YYYY-MM-DD. Default today.'),
        ...sourceArgs,
      },
    },
    safeMcpHandler(async (args) => {
      const idx = await getMcpIndexerReady();
      const snap = idx.getSnapshot();
      const ctx = { users: snap.userRecords, parentMap: snap.parentMap };
      const day = parseDayArg(args.date);
      const source = (args.source ?? 'all') as SourceArg;

      const totals = totalsWithBySource(snap.records, source, day, ctx);
      const sessions = sessionEntries(snap.records, snap.userRecords, source, day, ctx);
      const models = modelEntries(snap.records, source, day, ctx);
      const tools = topToolUses(snap.records, day, source);

      return asTextResult({
        date: day.label,
        from: day.from.toISOString(),
        to: day.to.toISOString(),
        source,
        totals: totals.totals,
        bySource: totals.bySource,
        session_count: sessions.length,
        sessions_by_project: groupSessionsByProject(sessions),
        models,
        top_tools: tools,
      });
    }),
  );

  server.registerTool(
    'weekly_summary',
    {
      title: 'Weekly summary',
      description:
        'A week-long roll-up: totals, per-day cost trend, top sessions by cost, top projects, and models used. Use `week_offset` to walk back (0=this week, -1=last week, etc.).',
      inputSchema: {
        week_offset: z
          .number()
          .int()
          .min(-52)
          .max(0)
          .default(0)
          .describe('0=this week, -1=last week, ..., -52=one year ago. Default 0.'),
        ...sourceArgs,
        top_session_limit: z.number().int().min(1).max(50).default(10),
      },
    },
    safeMcpHandler(async (args) => {
      const idx = await getMcpIndexerReady();
      const snap = idx.getSnapshot();
      const ctx = { users: snap.userRecords, parentMap: snap.parentMap };
      const offset = args.week_offset ?? 0;
      const week = weekWindow(offset);
      const source = (args.source ?? 'all') as SourceArg;

      const totals = totalsWithBySource(snap.records, source, week, ctx);

      const dayBuckets = timeBuckets(snap.records, source, 'day', {
        from: week.from,
        to: week.to,
      }, ctx);
      const byKey = new Map(dayBuckets.map((b) => [b.key, b]));
      const days: Array<{
        date: string;
        totals: FlatTotals;
        bySource: Record<ProviderId, FlatTotals>;
      }> = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(week.from);
        d.setDate(d.getDate() + i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const hit = byKey.get(key);
        if (hit) {
          days.push({ date: key, totals: hit.totals, bySource: hit.bySource });
        } else {

          days.push({
            date: key,
            totals: { ...ZERO_TOTALS_PUBLIC },
            bySource: {
              claude: { ...ZERO_TOTALS_PUBLIC },
              codex: { ...ZERO_TOTALS_PUBLIC },
            },
          });
        }
      }

      const allSessions = sessionEntries(snap.records, snap.userRecords, source, week, ctx);
      const topSessions = allSessions
        .slice()
        .sort((a, b) => b.cost_usd - a.cost_usd)
        .slice(0, args.top_session_limit ?? 10);

      const projects = projectEntries(snap.records, source, week, ctx).slice(0, 10);
      const models = modelEntries(snap.records, source, week, ctx);
      const tools = topToolUses(snap.records, week, source);

      return asTextResult({
        week: week.label,
        from: week.from.toISOString(),
        to: week.to.toISOString(),
        source,
        totals: totals.totals,
        bySource: totals.bySource,
        per_day: days,
        session_count: allSessions.length,
        top_sessions: topSessions,
        top_projects: projects,
        models,
        top_tools: tools,
      });
    }),
  );

  server.registerTool(
    'recent_activity',
    {
      title: 'Recent activity',
      description:
        'The N most recently active sessions across providers. Quick way to answer "what did I just work on" without specifying a date. Defaults to the last 30 days so the response time stays bounded regardless of how long the user has been running ccgauge — pass `days` to widen.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Number of sessions to return. Default 10.'),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe('Look-back window in days. Default 30. Increase if the user has long-running idle sessions you still want surfaced.'),
        ...sourceArgs,
      },
    },
    safeMcpHandler(async (args) => {
      const idx = await getMcpIndexerReady();
      const snap = idx.getSnapshot();
      const ctx = { users: snap.userRecords, parentMap: snap.parentMap };
      const source = (args.source ?? 'all') as SourceArg;
      const limit = args.limit ?? 10;
      const days = args.days ?? 30;

      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - (days - 1));
      from.setHours(0, 0, 0, 0);
      const to = new Date(now);
      to.setHours(23, 59, 59, 999);

      const sessions = sessionEntries(snap.records, snap.userRecords, source, {
        from,
        to,
      }, ctx)
        .slice()
        .sort((a, b) => b.end_time.localeCompare(a.end_time))
        .slice(0, limit);

      return asTextResult({
        source,
        window_days: days,
        from: from.toISOString(),
        to: to.toISOString(),
        returned_count: sessions.length,
        sessions,
      });
    }),
  );
}

export type { FlatSessionEntry, FlatProjectEntry, FlatModelEntry, AssistantRecord, ProviderId };
