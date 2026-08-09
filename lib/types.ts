import { z } from 'zod';

export const UsageSchema = z.object({
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  cache_creation_input_tokens: z.number().default(0),
  cache_read_input_tokens: z.number().default(0),
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: z.number().default(0),
      ephemeral_1h_input_tokens: z.number().default(0),
    })
    .partial()
    .optional(),
  service_tier: z.string().optional(),
  speed: z.string().optional(),
  server_tool_use: z
    .object({
      web_search_requests: z.number().optional(),
      web_fetch_requests: z.number().optional(),
    })
    .optional(),
});

export type Usage = z.infer<typeof UsageSchema>;

export const ContentBlockSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string().optional(),
  }),
  z.object({
    type: z.literal('thinking'),
    thinking: z.string().optional(),
    signature: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string().optional(),
    content: z.unknown().optional(),
  }),
  z.object({ type: z.string() }).passthrough(),
]);

export const AssistantMessageSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  type: z.string().optional(),
  role: z.string().optional(),
  content: z.array(ContentBlockSchema).optional(),
  stop_reason: z.string().nullable().optional(),
  usage: UsageSchema.optional(),
});

export const RawRecordSchema = z
  .object({
    type: z.string(),
    uuid: z.string().optional(),
    parentUuid: z.string().nullable().optional(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    cwd: z.string().optional(),
    gitBranch: z.string().optional(),
    version: z.string().optional(),
    entrypoint: z.string().optional(),
    userType: z.string().optional(),
    message: z
      .union([
        AssistantMessageSchema,
        z.object({ role: z.string().optional(), content: z.unknown().optional() }).passthrough(),
      ])
      .optional(),
    promptId: z.string().optional(),
    isSidechain: z.boolean().optional(),
    /** Set by Claude Code on messages IT injected into the conversation rather
     *  than ones the user typed — slash-command expansions, hook output, skill
     *  preambles, image placeholders. `.passthrough()` would carry it anyway;
     *  it is declared so the parser can read it without a cast. */
    isMeta: z.boolean().optional(),
    permissionMode: z.string().optional(),
  })
  .passthrough();

export type RawRecord = z.infer<typeof RawRecordSchema>;

export type ProviderId = 'claude' | 'codex';

export interface ToolUseRef {
  id: string;
  name: string;
}

export interface AssistantRecord {
  type: 'assistant';
  source: ProviderId;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  requestId: string;
  cwd: string;
  gitBranch?: string;
  version?: string;
  model: string;
  messageId: string;
  usage: Required<Pick<Usage, 'input_tokens' | 'output_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens'>> & {
    cache_creation_5m: number;
    cache_creation_1h: number;

    reasoning_tokens?: number;
  };
  toolNames: string[];
  /** Per-turn tool_use id→name, used to attribute the size of the matching
   *  tool_result (which lands on a later UserRecord) back to the tool that
   *  produced it. Consumed by lib/aggregator/tools.ts. Claude only. */
  toolUses?: ToolUseRef[];
  hasThinking: boolean;
  textPreview: string;
  filePath: string;

  effort?: string;

  isSidechain?: boolean;
  /** Lineage root this sub-agent transcript belongs to — see the UserRecord
   *  field. Needed on assistants too because a Codex sub-agent thread can
   *  carry NO user record at all (its task prompt is a `response_item`, not a
   *  `user_message`), leaving its assistants as the only thing to anchor. */
  parentSessionId?: string;
  /** True when this record came from a Workflow (ultracode) sub-agent
   *  transcript — i.e. a file under `subagents/workflows/wf_.../`, as
   *  opposed to a plain Task sub-agent. Stamped at snapshot rebuild via
   *  `detectSubagentKind`. Lets the usage table badge the spawning turn
   *  as a parallel-agent fan-out. */
  isWorkflowSubagent?: boolean;
}

export interface UserRecord {
  type: 'user';
  source: ProviderId;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  cwd: string;
  textPreview: string;
  /** Sizes (chars, not tokens) of tool_result blocks carried by this user
   *  message, keyed by the originating tool_use id. Token estimate is derived
   *  downstream. Claude only. */
  toolResults?: Array<{ toolUseId: string; chars: number }>;
  /** Set when this message is a "Base directory for this skill:" injection —
   *  the skill body loaded into context. `chars` measures that payload, which
   *  the tiny Skill tool_result ("Launching skill: X") does NOT capture. */
  skillInject?: { skill: string; chars: number };

  isSynthetic?: boolean;

  isSidechain?: boolean;
  /** Lineage root this sub-agent transcript belongs to. Claude derives the
   *  same thing from the file path; Codex only states it in `session_meta`,
   *  so the parser stamps it here for `linkSidechainParents` to consume. */
  parentSessionId?: string;
  filePath: string;
}

export type AnyRecord = AssistantRecord | UserRecord;

export interface ScanStats {
  filesScanned: number;
  recordsParsed: number;
  assistantRecords: number;
  durationMs: number;
  scannedDirs: string[];
}

export interface ScanResult {
  records: AssistantRecord[];
  userRecords: UserRecord[];
  parentMap: Record<string, string | null>;
  stats: ScanStats;
}

export interface ScanStatsBySource {
  source: ProviderId;
  filesScanned: number;
  recordsParsed: number;
  assistantRecords: number;
  scannedDirs: string[];
}

export interface Pricing {
  input: number;
  output: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  cacheRead: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  cacheRead: number;
  total: number;
  saved: number;
}

export interface AggregateBucket {
  key: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
  saved: number;
  requests: number;
  models: Record<string, { tokens: number; cost: number; requests: number }>;
}

export interface BlockSummary {
  id: string;
  startTime: string;
  endTime: string;
  actualEndTime: string;
  isActive: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
  saved: number;
  models: string[];
  requests: number;
}

export interface SessionSummary {
  sessionId: string;

  source: ProviderId;
  cwd: string;

  projectName: string;

  projectLabel: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
  saved: number;
  models: string[];
  modelBreakdown: Record<string, { tokens: number; cost: number; requests: number }>;
  title?: string;
  firstUserMessage?: string;
}

export interface ProjectSummary {

  source: ProviderId;
  cwd: string;
  projectName: string;
  sessions: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
  saved: number;
  firstActivity: string;
  lastActivity: string;
  models: string[];
}

export interface ModelSummary {
  model: string;
  source: ProviderId;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
  saved: number;
  pricing: Pricing | null;
  pricingResolved: boolean;
}

export type ToolDimension = 'tool' | 'skill' | 'mcp';

export interface ToolUsageSummary {
  key: string;
  dimension: ToolDimension;
  chars: number;
  estTokens: number;
  calls: number;
  sessions: number;
  largestChars: number;
}
