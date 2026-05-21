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
    permissionMode: z.string().optional(),
  })
  .passthrough();

export type RawRecord = z.infer<typeof RawRecordSchema>;

export type ProviderId = 'claude' | 'codex';

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
    /**
     * Reasoning tokens (OpenAI o-series / Codex). For display only — these
     * are already included in `output_tokens` and billed at the output
     * rate. Anthropic models leave this undefined.
     */
    reasoning_tokens?: number;
  };
  toolNames: string[];
  hasThinking: boolean;
  textPreview: string;
  filePath: string;
  /**
   * Provider-specific reasoning depth / effort tag.
   *   - Codex: turn_context.effort  (low / medium / high / minimal)
   *   - Claude: undefined (no equivalent in the JSONL)
   */
  effort?: string;
  /**
   * True when this record belongs to a Claude Code sub-agent invocation
   * (stored under `.../<parent-session-uuid>/subagents/agent-*.jsonl`).
   * Used by the indexer's post-link pass to identify subagent files and
   * by the UI for optional visual markers. Codex records leave this
   * undefined.
   */
  isSidechain?: boolean;
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
  /**
   * True when textPreview was injected by Claude Code itself rather than
   * typed by the human (skill metadata, <system-reminder>, sub-agent
   * synthesized prompts, etc.). Used to skip these as turn roots while
   * still letting them be displayed per-call.
   */
  isSynthetic?: boolean;
  /**
   * True when this record belongs to a Claude Code sub-agent invocation.
   * See {@link AssistantRecord.isSidechain}.
   */
  isSidechain?: boolean;
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
  /** Provider this session originated from. A session never spans both
   *  providers; populated by the aggregator from the first record's
   *  source. Used by the All view to label rows in mixed lists. */
  source: ProviderId;
  cwd: string;
  /** Plain basename of `cwd`. Always available, never worktree-aware. */
  projectName: string;
  /** Worktree-aware display label — `"<main-repo> (<worktree-name>)"`
   *  when `cwd` lives inside `.git/worktrees/...` or Claude Code's
   *  `.claude/worktrees/...`; otherwise identical to `projectName`.
   *  Same shape as `UsageTurnRow.projectLabel` so the sessions / usage
   *  tables stay in sync for cross-worktree projects. */
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
  /** Provider these aggregated records came from. For the All view,
   *  the same `cwd` may appear twice — once per source — so this field
   *  is the disambiguator. */
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
