import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import type { AssistantRecord, RawRecord, ToolUseRef, UserRecord } from '../types';

const TEXT_PREVIEW_MAX = 200;

interface CacheCreationBlock {
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

function safeStringLen(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}

// Size (chars) of a tool_result / message payload as it lands in context.
// Strings measure directly; block arrays sum text-block lengths and fall back
// to serialized length for non-text blocks (images, tool_reference).
function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const b of content) {
      if (b && typeof b === 'object') {
        const t = (b as Record<string, unknown>).text;
        n += typeof t === 'string' ? t.length : safeStringLen(b);
      } else if (typeof b === 'string') {
        n += b.length;
      }
    }
    return n;
  }
  return 0;
}

function extractUserText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const c of content as Array<Record<string, unknown>>) {
      if (c.type === 'text' && typeof c.text === 'string') return c.text;
    }
  }
  return '';
}

// A skill invocation loads its body as a synthetic user message whose first
// line is `Base directory for this skill: <path>`. The path basename is the
// skill slug — self-contained, so no join back to the Skill tool_use needed.
const SKILL_BASE_RE = /^Base directory for this skill:\s*(\S+)/;
function skillNameFromText(text: string): string | null {
  const m = SKILL_BASE_RE.exec(text.trimStart());
  if (!m) return null;
  const base = m[1].split(/[\\/]/).filter(Boolean).pop();
  return base || null;
}

export async function parseJsonlFile(file: string): Promise<{
  assistant: AssistantRecord[];
  user: UserRecord[];
  parentLinks: Array<[string, string | null]>;
}> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const assistant: AssistantRecord[] = [];
  const user: UserRecord[] = [];
  const parentLinks: Array<[string, string | null]> = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    let raw: RawRecord;
    try {
      raw = JSON.parse(line) as RawRecord;
    } catch {
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;

    if (raw.uuid) parentLinks.push([raw.uuid, raw.parentUuid ?? null]);

    if (raw.type === 'assistant') {
      const a = parseAssistant(raw, file);
      if (a) assistant.push(a);
    } else if (raw.type === 'user') {
      const u = parseUser(raw, file);
      if (u) user.push(u);
    }
  }

  return { assistant, user, parentLinks };
}

function parseAssistant(raw: RawRecord, file: string): AssistantRecord | null {
  const msg = raw.message as Record<string, unknown> | undefined;
  if (!msg) return null;
  const usage = msg.usage as Record<string, number> | undefined;
  if (!usage) return null;
  const model = (msg.model as string | undefined) ?? '';
  if (!model || model === '<synthetic>') return null;
  const messageId = (msg.id as string | undefined) ?? raw.uuid ?? '';
  if (!messageId && !raw.requestId) return null;

  const cacheCreation = usage.cache_creation as unknown as CacheCreationBlock | undefined;

  const content = Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : [];
  const toolNames: string[] = [];
  const toolUses: ToolUseRef[] = [];
  let hasThinking = false;
  let textPreview = '';
  for (const c of content) {
    if (c.type === 'tool_use' && typeof c.name === 'string') {
      toolNames.push(c.name);
      if (typeof c.id === 'string') toolUses.push({ id: c.id, name: c.name });
    } else if (c.type === 'thinking') {
      hasThinking = true;
    } else if (c.type === 'text' && typeof c.text === 'string' && !textPreview) {
      textPreview = (c.text as string).slice(0, TEXT_PREVIEW_MAX);
    }
  }

  return {
    type: 'assistant',
    source: 'claude',
    uuid: raw.uuid ?? messageId,
    parentUuid: raw.parentUuid ?? null,
    timestamp: raw.timestamp ?? new Date().toISOString(),
    sessionId: raw.sessionId ?? '',
    requestId: raw.requestId ?? '',
    cwd: raw.cwd ?? '',
    gitBranch: raw.gitBranch,
    version: raw.version,
    model,
    messageId,
    usage: {
      input_tokens: Number(usage.input_tokens) || 0,
      output_tokens: Number(usage.output_tokens) || 0,
      cache_creation_input_tokens: Number(usage.cache_creation_input_tokens) || 0,
      cache_read_input_tokens: Number(usage.cache_read_input_tokens) || 0,
      cache_creation_5m: Number(cacheCreation?.ephemeral_5m_input_tokens) || 0,
      cache_creation_1h: Number(cacheCreation?.ephemeral_1h_input_tokens) || 0,
    },
    toolNames,
    toolUses: toolUses.length ? toolUses : undefined,
    hasThinking,
    textPreview,
    filePath: file,
    isSidechain: raw.isSidechain === true ? true : undefined,
  };
}

function parseUser(raw: RawRecord, file: string): UserRecord | null {
  if (!raw.uuid) return null;
  const msg = raw.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  const fullText = extractUserText(content);
  const textPreview = fullText.slice(0, TEXT_PREVIEW_MAX);

  let toolResults: Array<{ toolUseId: string; chars: number }> | undefined;
  if (Array.isArray(content)) {
    for (const c of content as Array<Record<string, unknown>>) {
      if (c.type === 'tool_result' && typeof c.tool_use_id === 'string') {
        if (!toolResults) toolResults = [];
        toolResults.push({ toolUseId: c.tool_use_id, chars: contentChars(c.content) });
      }
    }
  }

  let skillInject: { skill: string; chars: number } | undefined;
  const skill = skillNameFromText(fullText);
  if (skill) skillInject = { skill, chars: contentChars(content) };

  const isSidechain = raw.isSidechain === true;
  // `isMeta` is Claude Code's own marker for a message it injected rather than
  // one the user typed, so it catches every shape at once — slash-command
  // expansions, Stop-hook announcements and feedback, skill preambles,
  // "Continue from where you left off.", malformed-tool-call retries, image
  // placeholders. Measured over a week of transcripts it is exact: 261 of 261
  // `isMeta` messages were injected, and none of 1437 real prompts carried it.
  // Before this, 8% of usage rows (82 of 1023) were titled with injected text.
  //
  // It does NOT subsume `isSyntheticUserText`: `<task-notification>` records
  // carry no `isMeta` at all (175 of 175 checked), so the prefix list below
  // still does the work the marker doesn't.
  const isSynthetic =
    isSidechain || raw.isMeta === true || (!!textPreview && isSyntheticUserText(textPreview));

  return {
    type: 'user',
    source: 'claude',
    uuid: raw.uuid,
    parentUuid: raw.parentUuid ?? null,
    timestamp: raw.timestamp ?? new Date().toISOString(),
    sessionId: raw.sessionId ?? '',
    cwd: raw.cwd ?? '',
    textPreview,
    toolResults,
    skillInject,
    isSynthetic,
    isSidechain: isSidechain ? true : undefined,
    filePath: file,
  };
}

/**
 * Prefix fallback for injected messages that carry no `isMeta` marker. The
 * marker is the primary signal (see `parseUser`); this list only has to cover
 * what it misses, plus transcripts written before Claude Code emitted it.
 */
export function isSyntheticUserText(text: string): boolean {
  const t = text.trimStart();

  if (t.startsWith('Base directory for this skill:')) return true;

  if (t.startsWith('<system-reminder>')) return true;

  if (t.startsWith('Caveat: The messages below were generated by')) return true;

  // Background-task / Workflow completion notifications are injected into the
  // main session by the harness (not authored by the user). Each one arrives
  // as a top-level `user` message whose parentUuid chains back to the turn
  // that spawned the task — so folding it (skipping it as a turn root) sends
  // the work it triggered back into that spawning turn instead of spawning a
  // standalone "<task-notification>…" row per completion.
  if (t.startsWith('<task-notification>')) return true;

  // A slash command lands as a PAIR of unmarked records: `<command-name>…`
  // with the args the user actually typed, then `<local-command-stdout>…`
  // echoing what the command printed. Only the echo is synthetic — skipping it
  // roots the turn on the invocation instead of on "Goal set: …".
  if (t.startsWith('<local-command-stdout>')) return true;
  return false;
}
