import { createReadStream, promises as fs } from 'node:fs';
import readline from 'node:readline';
import type { AssistantRecord, UserRecord } from '@/lib/types';
import type { ParsedFile } from '../types';

const TEXT_PREVIEW_MAX = 200;

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

const EMPTY_PARSE: ParsedFile = Object.freeze({
  assistant: [],
  user: [],
  parentLinks: [],
}) as ParsedFile;

/**
 * A `thread_spawn` subagent rollout is a MIRROR, not a new ledger: it replays the
 * parent's history and its `total_token_usage` samples the SAME shared lineage
 * counter the parent keeps logging, so counting it double-bills. Measured on real
 * data: 3 concurrent subagents reported 8.54M of "own" delta while the shared
 * counter advanced 3.13M, and a full day inflated 39.8M → 265.7M (6.7x).
 *
 * `forked_from_id` is the discriminator. Guardian / auto-review subagents
 * (`source.subagent.other`) never set it and DO own an independent counter
 * starting near 0, so they stay. Older Codex `thread_spawn` rollouts predate the
 * field and also stay — they had their own counter too.
 *
 * KNOWN GAP: user-initiated forks (`thread_source: 'user'` + `forked_from_id`)
 * replay the source's history too, then DIVERGE into genuinely new spend, so they
 * can't be dropped wholesale. Their replayed prefix stays double-counted; cutting
 * it needs cross-file lineage state this per-file parser doesn't have.
 * See scripts/test-codex-parser.mjs for the derivation.
 */
function isSubagentForkMirror(payload: Record<string, unknown>): boolean {
  return asString(payload.thread_source) === 'subagent' && !!asString(payload.forked_from_id);
}

function extractMessageText(payload: Record<string, unknown>): string {
  const msg = payload.message;
  if (typeof msg === 'string') return msg;
  const content = payload.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const c of content as Array<Record<string, unknown>>) {
      const t = c?.type;
      if ((t === 'input_text' || t === 'output_text' || t === 'text') && typeof c.text === 'string') {
        return c.text;
      }
    }
  }
  return '';
}

export async function parseCodexJsonlFile(file: string): Promise<ParsedFile> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const assistant: AssistantRecord[] = [];
  const user: UserRecord[] = [];
  const parentLinks: Array<[string, string | null]> = [];

  let sessionId = '';
  let sessionMetaSeen = false;
  // Set only for KEPT sub-agent rollouts (guardian / auto-review / legacy
  // spawns). Folds their turns into the conversation turn that spawned them
  // instead of listing each review pass as its own top-level row.
  let subagentLineageRoot = '';
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

  for await (const line of rl) {
    if (!line.trim()) continue;
    let evt: CodexEvent;
    try {
      evt = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }
    if (!evt || typeof evt !== 'object' || !evt.type) continue;
    const payload = (evt.payload ?? {}) as Record<string, unknown>;
    const rawTs = asString(evt.timestamp);
    const ts = rawTs || lastValidTs;
    if (rawTs) lastValidTs = rawTs;

    if (evt.type === 'session_meta') {
      // Replayed history re-emits the SOURCE thread's session_meta mid-file.
      // Rebinding identity there stamps our tail with the parent's session id.
      if (sessionMetaSeen) continue;
      sessionMetaSeen = true;

      if (isSubagentForkMirror(payload)) {
        rl.close();
        stream.destroy();
        return EMPTY_PARSE;
      }

      sessionId = asString(payload.id);
      if (asString(payload.thread_source) === 'subagent') {
        subagentLineageRoot =
          asString(payload.session_id) || asString(payload.parent_thread_id) || '';
      }
      defaultCwd = asString(payload.cwd);
      cliVersion = asString(payload.cli_version) || undefined;

      const metaTs = asString(payload.timestamp);
      if (metaTs) lastValidTs = metaTs;
      if (!turn.cwd) turn.cwd = defaultCwd;
      continue;
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
      continue;
    }

    if (evt.type === 'event_msg') {
      const sub = asString(payload.type);

      if (sub === 'user_message') {
        const text = extractMessageText(payload);
        if (!text) continue;
        const uuid = `${sessionId}::u${userIdx++}`;
        user.push({
          type: 'user',
          source: 'codex',
          uuid,
          parentUuid: null,
          timestamp: ts,
          sessionId,
          cwd: turn.cwd || defaultCwd,
          textPreview: text.slice(0, TEXT_PREVIEW_MAX),
          filePath: file,
          // Mirrors Claude's parse-jsonl: a sidechain user is synthetic, so it
          // never roots a turn of its own and the walk continues to the spawner.
          ...(subagentLineageRoot
            ? { isSidechain: true, isSynthetic: true, parentSessionId: subagentLineageRoot }
            : {}),
        });
        parentLinks.push([uuid, null]);
        turn.userUuid = uuid;
        continue;
      }

      if (sub === 'agent_message') {
        const text = extractMessageText(payload);
        if (text && !turn.pendingTextPreview) {
          turn.pendingTextPreview = text.slice(0, TEXT_PREVIEW_MAX);
        }
        continue;
      }

      if (sub === 'agent_reasoning') {
        turn.hasThinking = true;
        continue;
      }

      // Fallback only: rescues records that precede any `turn_context` (replayed
      // history carries none, so they fell back to the 'gpt-unknown' placeholder).
      // It must never outrank turn_context — this event is thread-level and in
      // real rollouts disagrees with the active turn 116 times out of 477,
      // which would bill e.g. a gpt-5.6-terra turn at gpt-5.6-sol's 2x rate.
      if (sub === 'thread_settings_applied') {
        if (turn.modelFromTurnContext) continue;
        const settings = payload.thread_settings as Record<string, unknown> | null | undefined;
        const m = settings ? asString(settings.model) : '';
        if (m) turn.model = m;
        continue;
      }

      if (sub === 'token_count') {
        const info = payload.info as Record<string, unknown> | null | undefined;
        if (!info) continue;
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

            deltaInput = cur.input;
            deltaCached = cur.cached;
            deltaOutput = cur.output;
            deltaReasoning = cur.reasoning;
          } else {
            deltaInput = Math.max(0, cur.input - prevTotal.input);
            deltaCached = Math.max(0, cur.cached - prevTotal.cached);
            deltaOutput = Math.max(0, cur.output - prevTotal.output);
            deltaReasoning = Math.max(0, cur.reasoning - prevTotal.reasoning);
          }

          if (
            deltaInput === 0 &&
            deltaCached === 0 &&
            deltaOutput === 0 &&
            deltaReasoning === 0
          ) {
            continue;
          }

          if (prevTotal === null) {
            prevTotal = { ...cur };
          } else {
            prevTotal = {
              input: Math.max(prevTotal.input, cur.input),
              cached: Math.max(prevTotal.cached, cur.cached),
              output: Math.max(prevTotal.output, cur.output),
              reasoning: Math.max(prevTotal.reasoning, cur.reasoning),
            };
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
            continue;
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
          continue;
        }

        const uuid = `${sessionId}::a${assistantIdx++}`;
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
          model: turn.model || 'gpt-unknown',
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
        continue;
      }
      continue;
    }

    if (evt.type === 'response_item') {
      const sub = asString(payload.type);

      if (sub === 'function_call' || sub === 'custom_tool_call') {
        const name = asString(payload.name);
        if (name) turn.toolNames.push(name);
        continue;
      }

      if (sub === 'reasoning') {
        turn.hasThinking = true;
        continue;
      }

      if (sub === 'message') {
        const role = asString(payload.role);
        if (role === 'assistant') {
          const text = extractMessageText(payload);
          if (text && !turn.pendingTextPreview) {
            turn.pendingTextPreview = text.slice(0, TEXT_PREVIEW_MAX);
          }
        }
        continue;
      }
      continue;
    }
  }

  return { assistant, user, parentLinks };
}
