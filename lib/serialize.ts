import type { BlockProgressInfo } from './blocks/compute';
import type { AssistantRecord, ProviderId, UserRecord } from './types';
import { costOfRecord } from './pricing/calculate';
import { buildTurnIndex } from './turns';
import { resolveProjectLabel } from './project-label';

export interface SerializedProgress {
  hasBlock: boolean;
  startTime?: string;
  endTime?: string;
  totalTokens: number;
  cost: number;
  requests: number;
  models: string[];
  burnRatePerMin: number;
  costPerMin: number;
  projectedTotal: number;
  projectedCost: number;
}

export function blockToSerialized(info: BlockProgressInfo | null): SerializedProgress {
  if (!info || !info.block) {
    return {
      hasBlock: false,
      totalTokens: 0,
      cost: 0,
      requests: 0,
      models: [],
      burnRatePerMin: 0,
      costPerMin: 0,
      projectedTotal: 0,
      projectedCost: 0,
    };
  }
  return {
    hasBlock: true,
    startTime: info.block.startTime,
    endTime: info.block.endTime,
    totalTokens: info.block.totalTokens,
    cost: info.block.cost,
    requests: info.block.requests,
    models: info.block.models,
    burnRatePerMin: info.burnRatePerMin,
    costPerMin: info.costPerMin,
    projectedTotal: info.projectedTotal,
    projectedCost: info.projectedCost,
  };
}

export interface UsageTableRow {
  uuid: string;
  timestamp: string;
  source: 'claude' | 'codex';
  model: string;
  cwd: string;

  projectLabel: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;

  reasoningTokens: number;
  totalTokens: number;
  cost: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  toolNames: string[];

  effort?: string;
  /** True when this call belongs to a Workflow (ultracode) sub-agent
   *  transcript — lets the expanded child row tag itself as a
   *  workflow-spawned agent call. */
  isWorkflowSubagent?: boolean;

  directPrompt?: string;
}

export function recordsToTableRows(records: AssistantRecord[]): UsageTableRow[] {
  return records.map((r) => {
    const c = costOfRecord(r);
    return {
      uuid: r.uuid,
      timestamp: r.timestamp,
      source: r.source,
      model: r.model,
      cwd: r.cwd,
      projectLabel: resolveProjectLabel(r.cwd),
      sessionId: r.sessionId,
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens,
      cacheCreationTokens: r.usage.cache_creation_input_tokens,
      reasoningTokens: r.usage.reasoning_tokens ?? 0,
      totalTokens:
        r.usage.input_tokens +
        r.usage.output_tokens +
        r.usage.cache_read_input_tokens +
        r.usage.cache_creation_input_tokens,
      cost: c.total,
      costInput: c.input,
      costOutput: c.output,
      costCacheRead: c.cacheRead,
      costCacheWrite: c.cacheCreation5m + c.cacheCreation1h,
      toolNames: r.toolNames,
      effort: r.effort,
    };
  });
}

export interface UsageTurnRow {
  turnId: string;
  /** Provider of this turn (all of a turn's calls share one session/source). */
  source: ProviderId;
  timestamp: string;
  endTimestamp: string;

  durationMs: number;
  cwd: string;

  projectLabel: string;
  sessionId: string;
  models: string[];
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;

  reasoningTokens: number;
  totalTokens: number;
  cost: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  toolNames: string[];

  efforts: string[];
  /** True when this turn spawned at least one Workflow (ultracode)
   *  sub-agent. Drives the "Workflow" badge. */
  hasWorkflowSubagents: boolean;
  /** Number of DISTINCT Workflow sub-agents this turn fanned out (counted
   *  by distinct transcript file, not by call — one agent makes many API
   *  calls). 0 when none. */
  workflowSubagentCount: number;
  userText: string;
  children: UsageTableRow[];
}

/**
 * A turn row without its per-call detail — what `/api/turns` puts on the wire.
 * `children` is fetched separately from `/api/turns/children` when a row is
 * expanded; inlining it made the list response ~200x bigger than the part
 * anyone actually looks at.
 */
export type UsageTurnSummary = Omit<UsageTurnRow, 'children'>;

export function recordsToTurnRows(
  assistants: AssistantRecord[],
  users: UserRecord[],
  parentMap: Record<string, string | null>,
): UsageTurnRow[] {
  const turnIndex = buildTurnIndex(assistants, users, parentMap);
  const userMap = new Map<string, UserRecord>();
  for (const u of users) userMap.set(u.uuid, u);

  const directPromptCache = new Map<string, string>();
  function resolveDirectPrompt(startUuid: string): string {
    const cached = directPromptCache.get(startUuid);
    if (cached !== undefined) return cached;
    const path: string[] = [];
    let cur: string | null = startUuid;
    let answer = '';
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const hit = directPromptCache.get(cur);
      if (hit !== undefined) {

        answer = hit;
        break;
      }
      path.push(cur);
      const u = userMap.get(cur);

      if (u && u.textPreview && u.textPreview.trim()) {
        answer = u.textPreview;
        break;
      }
      cur = parentMap[cur] ?? null;
    }
    for (const id of path) directPromptCache.set(id, answer);
    return answer;
  }

  const groups = new Map<string, UsageTableRow[]>();
  const order = new Map<string, AssistantRecord>();
  // Per-turn set of distinct Workflow sub-agent transcript files, so the
  // badge count reflects how many parallel agents fanned out (one agent
  // file emits many API-call records).
  const workflowFilesByTurn = new Map<string, Set<string>>();
  for (const r of assistants) {
    const turnId = turnIndex.get(r.uuid) ?? r.uuid;
    const c = costOfRecord(r);
    const direct = resolveDirectPrompt(r.uuid);
    if (r.isWorkflowSubagent) {
      let set = workflowFilesByTurn.get(turnId);
      if (!set) {
        set = new Set<string>();
        workflowFilesByTurn.set(turnId, set);
      }
      set.add(r.filePath);
    }
    const child: UsageTableRow = {
      uuid: r.uuid,
      timestamp: r.timestamp,
      source: r.source,
      model: r.model,
      cwd: r.cwd,
      projectLabel: resolveProjectLabel(r.cwd),
      sessionId: r.sessionId,
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens,
      cacheCreationTokens: r.usage.cache_creation_input_tokens,
      reasoningTokens: r.usage.reasoning_tokens ?? 0,
      totalTokens:
        r.usage.input_tokens +
        r.usage.output_tokens +
        r.usage.cache_read_input_tokens +
        r.usage.cache_creation_input_tokens,
      cost: c.total,
      costInput: c.input,
      costOutput: c.output,
      costCacheRead: c.cacheRead,
      costCacheWrite: c.cacheCreation5m + c.cacheCreation1h,
      toolNames: r.toolNames,
      effort: r.effort,
      isWorkflowSubagent: r.isWorkflowSubagent || undefined,
      directPrompt: direct || undefined,
    };
    const list = groups.get(turnId);
    if (list) list.push(child);
    else groups.set(turnId, [child]);
    if (!order.has(turnId)) order.set(turnId, r);
  }

  const turns: UsageTurnRow[] = [];
  for (const [turnId, children] of groups) {
    children.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    const first = children[0];
    const last = children[children.length - 1];
    const modelSet = new Set<string>();
    const toolSet = new Set<string>();
    const effortSet = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let reasoningTokens = 0;
    let cost = 0;
    let costInput = 0;
    let costOutput = 0;
    let costCacheRead = 0;
    let costCacheWrite = 0;
    for (const c of children) {
      modelSet.add(c.model);
      for (const t of c.toolNames) toolSet.add(t);
      if (c.effort) effortSet.add(c.effort);
      inputTokens += c.inputTokens;
      outputTokens += c.outputTokens;
      cacheReadTokens += c.cacheReadTokens;
      cacheCreationTokens += c.cacheCreationTokens;
      reasoningTokens += c.reasoningTokens;
      cost += c.cost;
      costInput += c.costInput;
      costOutput += c.costOutput;
      costCacheRead += c.costCacheRead;
      costCacheWrite += c.costCacheWrite;
    }
    const userRec = userMap.get(turnId);
    const startMs = new Date(first.timestamp).getTime();
    const endMs = new Date(last.timestamp).getTime();
    const durationMs =
      Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
    turns.push({
      turnId,
      source: first.source,
      timestamp: first.timestamp,
      endTimestamp: last.timestamp,
      durationMs,
      cwd: first.cwd,
      projectLabel: resolveProjectLabel(first.cwd),
      sessionId: first.sessionId,
      models: Array.from(modelSet),
      callCount: children.length,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      reasoningTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
      cost,
      costInput,
      costOutput,
      costCacheRead,
      costCacheWrite,
      toolNames: Array.from(toolSet),
      efforts: Array.from(effortSet),
      hasWorkflowSubagents: (workflowFilesByTurn.get(turnId)?.size ?? 0) > 0,
      workflowSubagentCount: workflowFilesByTurn.get(turnId)?.size ?? 0,
      userText: userRec?.textPreview ?? '',
      children,
    });
  }

  turns.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return turns;
}
