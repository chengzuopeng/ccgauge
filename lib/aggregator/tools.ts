import type {
  AssistantRecord,
  ProviderId,
  ToolDimension,
  ToolUsageSummary,
  UserRecord,
} from '../types';

// Crude tokenizer proxy. The JSONL never records per-tool_result tokens, so we
// estimate from char length. ~4 chars/token holds well enough that the RANKING
// (the thing the user needs) is stable even when the absolute number is off.
const CHARS_PER_TOKEN = 4;

export interface ToolAggregateOpts {
  sources: ProviderId[];
  from?: Date;
  to?: Date;
  projects?: string[];
}

interface Acc {
  chars: number;
  calls: number;
  largest: number;
  sessions: Set<string>;
}

/** mcp__<server>__<tool> → <server>; null for non-MCP tool names. */
function mcpServer(name: string): string | null {
  if (!name.startsWith('mcp__')) return null;
  return name.split('__')[1] || null;
}

/**
 * Attribute the size of every tool_result / skill-body injection to the tool,
 * skill, or MCP server that produced it, then rank descending.
 *
 * Why the join lives here and not in the parser: tool_use (id→name) is on the
 * assistant record, but the tool_result payload it produced lands on a *later*
 * user record. Both are in the deduped snapshot, so we resolve the id→name map
 * once and walk the user records.
 */
export function aggregateTools(
  assistants: AssistantRecord[],
  users: UserRecord[],
  dimension: ToolDimension,
  opts: ToolAggregateOpts,
): ToolUsageSummary[] {
  const sources = new Set(opts.sources);
  const fromIso = opts.from?.toISOString();
  const toIso = opts.to?.toISOString();
  const projects = opts.projects?.length ? new Set(opts.projects) : undefined;

  const idToName = new Map<string, string>();
  for (const a of assistants) {
    if (!sources.has(a.source) || !a.toolUses) continue;
    for (const tu of a.toolUses) idToName.set(tu.id, tu.name);
  }

  const map = new Map<string, Acc>();
  const bump = (key: string, chars: number, sid: string) => {
    let a = map.get(key);
    if (!a) {
      a = { chars: 0, calls: 0, largest: 0, sessions: new Set() };
      map.set(key, a);
    }
    a.chars += chars;
    a.calls += 1;
    if (chars > a.largest) a.largest = chars;
    a.sessions.add(sid);
  };

  for (const u of users) {
    if (!sources.has(u.source)) continue;
    if (fromIso && u.timestamp < fromIso) continue;
    if (toIso && u.timestamp > toIso) continue;
    if (projects && !projects.has(u.cwd)) continue;
    const sid = u.sessionId || u.uuid;

    if (dimension === 'skill') {
      if (u.skillInject) bump(u.skillInject.skill, u.skillInject.chars, sid);
      continue;
    }

    if (u.toolResults) {
      for (const tr of u.toolResults) {
        const name = idToName.get(tr.toolUseId) ?? '(unknown)';
        // The Skill tool_result is a tiny "Launching skill: X" ack — the real
        // payload is the skill body, folded in below. Skip the ack so Skill's
        // call count stays equal to the number of invocations.
        if (name === 'Skill') continue;
        if (dimension === 'mcp') {
          const server = mcpServer(name);
          if (server) bump(server, tr.chars, sid);
        } else {
          bump(name, tr.chars, sid);
        }
      }
    }

    // Fold the skill body into a 'Skill' pseudo-tool so the by-tool view shows
    // Skill's true weight; the by-skill view breaks it down further.
    if (dimension === 'tool' && u.skillInject) {
      bump('Skill', u.skillInject.chars, sid);
    }
  }

  const rows: ToolUsageSummary[] = [];
  for (const [key, a] of map) {
    rows.push({
      key,
      dimension,
      chars: a.chars,
      estTokens: Math.round(a.chars / CHARS_PER_TOKEN),
      calls: a.calls,
      sessions: a.sessions.size,
      largestChars: a.largest,
    });
  }
  rows.sort((x, y) => y.chars - x.chars);
  return rows;
}
