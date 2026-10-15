import { promises as fs } from 'node:fs';
import type { AssistantRecord, UserRecord } from '@/lib/types';
import type { ParsedFile, SpawnedSessionLink } from '../types';
import { splitModelRoute } from './model-route.js';
import { forEachLine } from '../../data-loader/read-lines.js';

const TEXT_PREVIEW_MAX = 200;

// `codex review` starts a brand-new top-level session whose `session_meta`
// carries no `parent_thread_id`, so nothing on the child side says which
// conversation ran it. What it does do is print a startup banner, and when the
// caller is an agent that banner lands in the spawning turn's tool output:
//
//   OpenAI Codex v0.147.0
//   --------
//   workdir: /Users/x/proj
//   ...
//   session id: 019fe02e-db7c-7a70-aaea-89e83e9b03d1
//
// Verified on every `codex review` in a 3-month history (5/5, cli_version
// 0.144.1 and 0.147.0, carried by both `function_call_output` and
// `custom_tool_call_output`). The needle is checked before the regex runs, and
// only against tool-output lines; `session_meta`'s JSON key is `session_id`,
// which cannot match `session id: `.
const SPAWN_BANNER_NEEDLE = 'session id: ';
const SPAWN_BANNER =
  /session id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const SPAWN_BANNER_NEEDLE_BYTES = Buffer.from(SPAWN_BANNER_NEEDLE);
const USER_MESSAGE_BYTES = Buffer.from('"UserMessage"');
const CLOSING_BRACE = 0x7d;
const HEAD_BYTES = 240;
const CODEX_LINE_HEAD =
  /^\{"timestamp":"([^"]*)",(?:"ordinal":\d+,)?"type":"([a-z_]+)"(?:,"payload":\{"type":"([A-Za-z_]+)"(?:,"id":"[^"]*")?(?:,"role":"([a-z_]+)")?)?/;

async function fileMtimeIso(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file);
    return new Date(stat.mtimeMs).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

interface CodexEvent {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown> | null;
}

interface TurnState {
  turnId: string | null;
  cwd: string;
  model: string;
  /** `turn_context` is the per-turn, authoritative model. Once it has spoken,
   *  `thread_settings_applied` (thread-level, fires between turns and can carry
   *  a stale default) must not override it. */
  modelFromTurnContext: boolean;
  effort?: string;
  userUuid: string | null;
  toolNames: string[];
  hasThinking: boolean;
  pendingTextPreview: string;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A forked subagent rollout is a MIRROR, not a new ledger: it replays the
 * parent's history and its `total_token_usage` samples the SAME shared lineage
 * counter the parent keeps logging, so counting it double-bills. Measured on real
 * data: 3 concurrent subagents reported 8.54M of "own" delta while the shared
 * counter advanced 3.13M, and a full day inflated 39.8M → 265.7M (6.7x).
 *
 * `forked_from_id` is the ONLY signal that separates a mirror from a real
 * subagent thread, and it is weaker than it looks: one Codex version emits
 * `thread_spawn` rollouts both with and without it. Verified — rollouts
 * `…T16-03-45` (present) and `…T16-12-34` (absent) are both `thread_spawn`,
 * both `depth: 1`, both cli_version 0.146.0-alpha.9.2, nine minutes apart. So
 * absence does NOT mean "old Codex"; it means "this spawn kept its own ledger".
 *
 * There is deliberately no data-level cross-check, because none holds: a mirror
 * that replays from the very start of the parent opens its counter at the same
 * small value a fresh thread does (`…T16-03-45` opens at 27,131 — a mirror —
 * versus 28,588 for the real thread in `…T16-12-34`). Distinguishing those two
 * needs cross-file lineage state this per-file parser does not have. If Codex
 * ever drops the field on a real mirror, double-counting returns silently;
 * scripts/test-codex-parser.mjs pins both shapes so the rule can't be
 * "simplified" on the false assumption that this is a version split.
 *
 * User-initiated forks (`thread_source: 'user'` + `forked_from_id`) DIVERGE into
 * genuinely new spend, so they can't be dropped wholesale. Their counter opens at
 * the parent's whole history, and that prefix is already billed in the parent's
 * own rollout, so the first delta comes from `last_token_usage` and the total only
 * seeds `prevTotal`. KNOWN GAP, still open: a fork whose history replays
 * `token_count` events (none seen locally) bills each replayed delta a second time,
 * and one whose first `token_count` lacks `last_token_usage` falls back to the
 * total and bills the prefix.
 */
function isSubagentForkMirror(payload: Record<string, unknown>): boolean {
  return asString(payload.thread_source) === 'subagent' && !!asString(payload.forked_from_id);
}

function isSubagentThread(payload: Record<string, unknown>): boolean {
  const threadSource = asString(payload.thread_source);
  if (threadSource === 'subagent' || threadSource === 'guardian_review') return true;
  const source = payload.source;
  return typeof source === 'object' && source !== null && 'subagent' in source;
}

function extractMessageText(payload: Record<string, unknown>): string {
  const msg = payload.message;
  if (typeof msg === 'string') return msg;
  const content = payload.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const c of content as Array<Record<string, unknown>>) {
      // Case-insensitive: the same field is `"text"` on a UserMessage item and
      // `"Text"` on an AgentMessage one.
      const t = typeof c?.type === 'string' ? c.type.toLowerCase() : '';
      if ((t === 'input_text' || t === 'output_text' || t === 'text') && typeof c.text === 'string') {
        return c.text;
      }
    }
  }
  return '';
}

export async function parseCodexJsonlFile(file: string): Promise<ParsedFile> {
  const assistant: AssistantRecord[] = [];
  const user: UserRecord[] = [];
  const parentLinks: Array<[string, string | null]> = [];
  const spawnedSessions: SpawnedSessionLink[] = [];
  const spawnedSeen = new Set<string>();

  let sessionId = '';
  let sessionMetaSeen = false;
  // Set when the flat `user_message` shape appears, so the `item_completed`
  // envelope defers to it rather than recording the same turn twice.
  let sawFlatUserMessage = false;
  // Set only for KEPT sub-agent rollouts (guardian / auto-review / legacy
  // spawns). Folds their turns into the conversation turn that spawned them
  // instead of listing each review pass as its own top-level row.
  let subagentLineageRoot = '';
  // `codex review`'s launcher thread: `thread_source: 'user'` yet every one of
  // its user messages is a prompt Codex synthesised ("Review the code changes
  // against the base branch …"), so none of them may root a turn.
  let reviewLauncher = false;
  let inheritsHistory = false;
  let cliVersion: string | undefined;
  let defaultCwd = '';
  let userIdx = 0;
  let assistantIdx = 0;

  let prevTotal: { input: number; cached: number; output: number; reasoning: number } | null = null;

  const fileMtime = await fileMtimeIso(file);
  let lastValidTs = fileMtime;

  const turn: TurnState = {
    turnId: null,
    cwd: '',
    model: 'gpt-unknown',
    modelFromTurnContext: false,
    userUuid: null,
    toolNames: [],
    hasThinking: false,
    pendingTextPreview: '',
  };

  // Shared by both event shapes a user turn can arrive in.
  function pushUserMessage(text: string, timestamp: string): void {
    if (!text) return;
    const uuid = `${sessionId}::u${userIdx++}`;
    user.push({
      type: 'user',
      source: 'codex',
      uuid,
      parentUuid: null,
      timestamp,
      sessionId,
      cwd: turn.cwd || defaultCwd,
      textPreview: text.slice(0, TEXT_PREVIEW_MAX),
      filePath: file,
      // Mirrors Claude's parse-jsonl: a sidechain user is synthetic, so it
      // never roots a turn of its own and the walk continues to the spawner.
      // A review launcher knows it is one but not who spawned it — that link
      // arrives later, from the banner the spawning transcript recorded.
      ...(subagentLineageRoot
        ? { isSidechain: true, isSynthetic: true, parentSessionId: subagentLineageRoot }
        : reviewLauncher
          ? { isSidechain: true, isSynthetic: true }
          : {}),
    });
    parentLinks.push([uuid, null]);
    turn.userUuid = uuid;
  }

  // Attribute a session started from inside this turn back to this turn.
  function recordSpawnBanner(line: string): void {
    if (!turn.userUuid) return;
    SPAWN_BANNER.lastIndex = 0;
    for (let m = SPAWN_BANNER.exec(line); m; m = SPAWN_BANNER.exec(line)) {
      const child = m[1].toLowerCase();
      // A long-running command is polled repeatedly and reprints its banner
      // each time; the first sighting is the one inside the spawning turn.
      if (child === sessionId || spawnedSeen.has(child)) continue;
      spawnedSeen.add(child);
      spawnedSessions.push({ sessionId: child, parentUuid: turn.userUuid });
    }
  }

  let forkMirror = false;
  await forEachLine(file, (buf) => {
    if (buf.length > 0 && buf[buf.length - 1] === CLOSING_BRACE) {
      const head = CODEX_LINE_HEAD.exec(buf.toString('latin1', 0, Math.min(buf.length, HEAD_BYTES)));
      if (head) {
        const [, headTs, type, sub, role] = head;
        let skip = false;
        if (type === 'compacted' || type === 'world_state') {
          skip = true;
        } else if (type === 'response_item') {
          if (sub === 'reasoning') {
            turn.hasThinking = true;
            skip = true;
          } else if (sub === 'function_call_output' || sub === 'custom_tool_call_output') {
            if (buf.indexOf(SPAWN_BANNER_NEEDLE_BYTES) !== -1) recordSpawnBanner(buf.toString('utf8'));
            skip = true;
          } else if (sub === 'image_generation_call') {
            skip = true;
          } else if (sub === 'message') {
            skip = !!turn.pendingTextPreview || (!!role && role !== 'assistant');
          }
        } else if (type === 'event_msg') {
          if (sub === 'agent_reasoning') {
            turn.hasThinking = true;
            skip = true;
          } else if (sub === 'item_completed') {
            skip = sawFlatUserMessage || buf.indexOf(USER_MESSAGE_BYTES) === -1;
          }
        }
        if (skip) {
          if (headTs) lastValidTs = headTs;
          return;
        }
      }
    }
    const line = buf.toString('utf8');
    if (!line.trim()) return;
    let evt: CodexEvent;
    try {
      evt = JSON.parse(line) as CodexEvent;
    } catch {
      return;
    }
    if (!evt || typeof evt !== 'object' || !evt.type) return;
    const payload = (evt.payload ?? {}) as Record<string, unknown>;
    const rawTs = asString(evt.timestamp);
    const ts = rawTs || lastValidTs;
    if (rawTs) lastValidTs = rawTs;

    if (evt.type === 'session_meta') {
      // Replayed history re-emits the SOURCE thread's session_meta mid-file.
      // Rebinding identity there stamps our tail with the parent's session id.
      if (sessionMetaSeen) return;
      sessionMetaSeen = true;

      if (isSubagentForkMirror(payload)) {
        forkMirror = true;
        return false;
      }

      sessionId = asString(payload.id);
      inheritsHistory = !!asString(payload.forked_from_id);
      if (isSubagentThread(payload)) {
        subagentLineageRoot =
          asString(payload.session_id) || asString(payload.parent_thread_id) || '';
      }
      defaultCwd = asString(payload.cwd);
      cliVersion = asString(payload.cli_version) || undefined;

      const metaTs = asString(payload.timestamp);
      if (metaTs) lastValidTs = metaTs;
      if (!turn.cwd) turn.cwd = defaultCwd;
      return;
    }

    if (evt.type === 'turn_context') {
      turn.turnId = asString(payload.turn_id) || turn.turnId;
      turn.cwd = asString(payload.cwd) || defaultCwd;
      const m = asString(payload.model);
      if (m) {
        turn.model = m;
        turn.modelFromTurnContext = true;
      }
      const eff = asString(payload.effort);
      if (eff) turn.effort = eff;
      turn.toolNames = [];
      turn.hasThinking = false;
      turn.pendingTextPreview = '';
      return;
    }

    if (evt.type === 'event_msg') {
      const sub = asString(payload.type);

      // Always the first event of a `codex review` launcher, so it lands before
      // the synthesised prompts it has to suppress. Verified on every such
      // rollout in a 3-month history (5/5, cli_version 0.144.1 and 0.147.0).
      if (sub === 'entered_review_mode') {
        reviewLauncher = true;
        return;
      }

      if (sub === 'user_message') {
        sawFlatUserMessage = true;
        pushUserMessage(extractMessageText(payload), ts);
        return;
      }

      // Codex 0.147's interactive TUI (`originator: codex-tui`) wraps events in
      // an `item_completed` envelope instead of emitting the flat `user_message`
      // / `agent_message` sub-types. Note this is NOT a version split: the same
      // 0.147.0 writes the flat shape from `codex exec` and the envelope from
      // the TUI, in the same session directory.
      //
      // Only the user turn is read from the envelope. `response_item` still
      // carries the assistant text, the reasoning and the tool calls in both
      // shapes — verified one-for-one on a real TUI rollout — so taking those
      // from here as well would double-count every tool call.
      if (sub === 'item_completed') {
        // Belt and braces: the two shapes have never appeared in one session,
        // but if a transitional build emits both, the flat event wins and this
        // doesn't add a second copy of the same turn.
        if (sawFlatUserMessage) return;
        const item = payload.item as Record<string, unknown> | null | undefined;
        if (!item || asString(item.type) !== 'UserMessage') return;
        pushUserMessage(extractMessageText(item), ts);
        return;
      }

      if (sub === 'agent_message') {
        const text = extractMessageText(payload);
        if (text && !turn.pendingTextPreview) {
          turn.pendingTextPreview = text.slice(0, TEXT_PREVIEW_MAX);
        }
        return;
      }

      if (sub === 'agent_reasoning') {
        turn.hasThinking = true;
        return;
      }

      // Fallback only: rescues records that precede any `turn_context` (replayed
      // history carries none, so they fell back to the 'gpt-unknown' placeholder).
      // It must never outrank turn_context — this event is thread-level and in
      // real rollouts disagrees with the active turn 116 times out of 477,
      // which would bill e.g. a gpt-5.6-terra turn at gpt-5.6-sol's 2x rate.
      if (sub === 'thread_settings_applied') {
        if (turn.modelFromTurnContext) return;
        const settings = payload.thread_settings as Record<string, unknown> | null | undefined;
        const m = settings ? asString(settings.model) : '';
        if (m) turn.model = m;
        return;
      }

      if (sub === 'token_count') {
        const info = payload.info as Record<string, unknown> | null | undefined;
        if (!info) return;
        const total = info.total_token_usage as Record<string, unknown> | undefined;
        const last = info.last_token_usage as Record<string, unknown> | undefined;

        const cur = total
          ? {
              input: asNumber(total.input_tokens),
              cached: asNumber(total.cached_input_tokens),
              output: asNumber(total.output_tokens),
              reasoning: asNumber(total.reasoning_output_tokens),
            }
          : null;

        let deltaInput: number;
        let deltaCached: number;
        let deltaOutput: number;
        let deltaReasoning: number;

        if (cur) {
          if (prevTotal === null) {
            const own = inheritsHistory ? last : undefined;
            deltaInput = own ? asNumber(own.input_tokens) : cur.input;
            deltaCached = own ? asNumber(own.cached_input_tokens) : cur.cached;
            deltaOutput = own ? asNumber(own.output_tokens) : cur.output;
            deltaReasoning = own ? asNumber(own.reasoning_output_tokens) : cur.reasoning;
            prevTotal = { ...cur };
          } else {
            deltaInput = Math.max(0, cur.input - prevTotal.input);
            deltaCached = Math.max(0, cur.cached - prevTotal.cached);
            deltaOutput = Math.max(0, cur.output - prevTotal.output);
            deltaReasoning = Math.max(0, cur.reasoning - prevTotal.reasoning);
            prevTotal = {
              input: Math.max(prevTotal.input, cur.input),
              cached: Math.max(prevTotal.cached, cur.cached),
              output: Math.max(prevTotal.output, cur.output),
              reasoning: Math.max(prevTotal.reasoning, cur.reasoning),
            };
          }

          if (
            deltaInput === 0 &&
            deltaCached === 0 &&
            deltaOutput === 0 &&
            deltaReasoning === 0
          ) {
            return;
          }
        } else if (last) {
          deltaInput = asNumber(last.input_tokens);
          deltaCached = asNumber(last.cached_input_tokens);
          deltaOutput = asNumber(last.output_tokens);
          deltaReasoning = asNumber(last.reasoning_output_tokens);
          if (
            deltaInput === 0 &&
            deltaCached === 0 &&
            deltaOutput === 0 &&
            deltaReasoning === 0
          ) {
            return;
          }
          if (prevTotal === null) {
            prevTotal = {
              input: deltaInput,
              cached: deltaCached,
              output: deltaOutput,
              reasoning: deltaReasoning,
            };
          } else {
            prevTotal = {
              input: prevTotal.input + deltaInput,
              cached: prevTotal.cached + deltaCached,
              output: prevTotal.output + deltaOutput,
              reasoning: prevTotal.reasoning + deltaReasoning,
            };
          }
        } else {
          return;
        }

        const uuid = `${sessionId}::a${assistantIdx++}`;
        const split = splitModelRoute(turn.model || 'gpt-unknown');
        const requestId = turn.turnId
          ? `${turn.turnId}::a${assistantIdx}`
          : `${sessionId}::a${assistantIdx}`;

        assistant.push({
          type: 'assistant',
          source: 'codex',
          uuid,
          parentUuid: turn.userUuid,
          timestamp: ts,
          sessionId,
          requestId,
          cwd: turn.cwd || defaultCwd,
          version: cliVersion,
          model: split.model,
          ...(split.route ? { modelRoute: split.route } : {}),
          messageId: requestId,
          usage: {
            input_tokens: Math.max(0, deltaInput - deltaCached),
            // Codex's raw `output_tokens` ALREADY includes reasoning tokens
            // (verified against real ~/.codex data: input + output === total).
            // Bill the raw output as-is and keep `reasoning_tokens` as a
            // display-only subset — re-adding it here would double-count the
            // reasoning at the output rate. Mirrors ccusage, which bills
            // `output_tokens` and surfaces `reasoning_output_tokens` separately.
            output_tokens: deltaOutput,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: deltaCached,
            cache_creation_5m: 0,
            cache_creation_1h: 0,
            reasoning_tokens: deltaReasoning,
          },
          toolNames: [...turn.toolNames],
          hasThinking: turn.hasThinking,
          textPreview: turn.pendingTextPreview,
          filePath: file,
          effort: turn.effort,
          ...(subagentLineageRoot
            ? { isSidechain: true, parentSessionId: subagentLineageRoot }
            : {}),
        });
        parentLinks.push([uuid, turn.userUuid]);

        turn.toolNames = [];
        turn.hasThinking = false;
        turn.pendingTextPreview = '';
        return;
      }
      return;
    }

    if (evt.type === 'response_item') {
      const sub = asString(payload.type);

      if (sub === 'function_call' || sub === 'custom_tool_call') {
        const name = asString(payload.name);
        if (name) turn.toolNames.push(name);
        return;
      }

      if (sub === 'reasoning') {
        turn.hasThinking = true;
        return;
      }

      if (sub === 'message') {
        const role = asString(payload.role);
        if (role === 'assistant') {
          const text = extractMessageText(payload);
          if (text && !turn.pendingTextPreview) {
            turn.pendingTextPreview = text.slice(0, TEXT_PREVIEW_MAX);
          }
        }
        return;
      }

      // Scanned on the raw line rather than the parsed payload: the banner sits
      // inside a doubly-escaped string in `output`, and re-serialising a 30k-token
      // tool result to reach it costs far more than one substring check.
      if (sub === 'function_call_output' || sub === 'custom_tool_call_output') {
        if (line.includes(SPAWN_BANNER_NEEDLE)) recordSpawnBanner(line);
        return;
      }
      return;
    }
  });

  if (forkMirror) return { assistant: [], user: [], parentLinks: [] };
  return { assistant, user, parentLinks, spawnedSessions };
}
