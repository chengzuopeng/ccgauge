'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  formatUSDPrecise,
  formatDateTime,
  formatDuration,
  formatTokensCompact,
  shortHash,
  shortenModel,
  projectNameFromCwd,
  cn,
} from '@/lib/utils';
import type { UsageTableRow, UsageTurnRow, UsageTurnSummary } from '@/lib/serialize';
import { useT, useI18n } from '@/lib/i18n/context';
import type { Locale } from '@/lib/i18n/dict';
import { HoverCard } from '@/components/hover-card';
import { ScrollShadows } from '@/components/scroll-shadows';
import type { SortKey } from '@/lib/usage-query';
import { usePendingNav } from '@/lib/use-pending-nav';

type ColumnId =
  | 'time'
  | 'duration'
  | 'prompt'
  | 'model'
  | 'project'
  | 'session'
  | 'calls'
  | 'input'
  | 'output'
  | 'cacheRead'
  | 'cacheWrite'
  | 'total'
  | 'cost'
  | 'tools';

interface ColumnDef {
  id: ColumnId;
  labelKey: string;
  align?: 'left' | 'right';
  sortKey?: SortKey;
  defaultVisible: boolean;
}

const COLUMNS: ColumnDef[] = [
  { id: 'time', labelKey: 'usage.col.time', sortKey: 'timestamp', defaultVisible: true },
  { id: 'duration', labelKey: 'usage.col.duration', align: 'right', sortKey: 'durationMs', defaultVisible: false },
  { id: 'prompt', labelKey: 'usage.col.userMessage', defaultVisible: true },
  { id: 'model', labelKey: 'usage.col.model', defaultVisible: true },
  { id: 'project', labelKey: 'usage.col.project', defaultVisible: true },
  { id: 'session', labelKey: 'usage.col.session', defaultVisible: false },
  { id: 'calls', labelKey: 'usage.col.calls', align: 'right', sortKey: 'callCount', defaultVisible: false },
  { id: 'input', labelKey: 'usage.col.input', align: 'right', sortKey: 'inputTokens', defaultVisible: false },
  { id: 'output', labelKey: 'usage.col.output', align: 'right', sortKey: 'outputTokens', defaultVisible: false },
  { id: 'cacheRead', labelKey: 'usage.col.cacheRead', align: 'right', sortKey: 'cacheReadTokens', defaultVisible: false },
  { id: 'cacheWrite', labelKey: 'usage.col.cacheWrite', align: 'right', sortKey: 'cacheCreationTokens', defaultVisible: false },
  { id: 'total', labelKey: 'usage.col.total', align: 'right', sortKey: 'totalTokens', defaultVisible: true },
  { id: 'cost', labelKey: 'usage.col.cost', align: 'right', sortKey: 'cost', defaultVisible: false },
  { id: 'tools', labelKey: 'usage.col.tools', defaultVisible: false },
];

const STORAGE_KEY = 'ccgauge.usage.cols.v4';

/** Matches the server default; a turn can hold thousands of calls, and
 *  rendering them all at once cost 2.1s of blocked main thread. */
const CHILDREN_PAGE_SIZE = 200;

interface ChildState {
  items: UsageTableRow[];
  total: number;
  loading: boolean;
  error?: string;
}

function defaultVisible(): Record<ColumnId, boolean> {
  return COLUMNS.reduce(
    (acc, c) => {
      acc[c.id] = c.defaultVisible;
      return acc;
    },
    {} as Record<ColumnId, boolean>,
  );
}

function loadVisible(): Record<ColumnId, boolean> {
  if (typeof window === 'undefined') return defaultVisible();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultVisible();
    const parsed = JSON.parse(raw) as Partial<Record<ColumnId, boolean>>;
    const base = defaultVisible();
    for (const c of COLUMNS) {
      if (typeof parsed[c.id] === 'boolean') base[c.id] = parsed[c.id]!;
    }
    return base;
  } catch {
    return defaultVisible();
  }
}

interface UsageTableProps {
  rows: UsageTurnSummary[];
  totalCount: number;
  page: number;
  pageCount: number;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  query: string;
  /** Codex fast/priority service tier active (read fresh from config.toml) → mark Codex rows with ·fast. */
  codexFastActive: boolean;
}

export function UsageTable({ rows, totalCount, page, pageCount, sort, query, codexFastActive }: UsageTableProps) {
  const t = useT();
  const { locale } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const { pending, navigate } = usePendingNav();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenById, setChildrenById] = useState<Record<string, ChildState>>({});
  const [visible, setVisible] = useState<Record<ColumnId, boolean>>(defaultVisible);
  const [colsOpen, setColsOpen] = useState(false);
  const [colsPos, setColsPos] = useState<{ top: number; right: number } | null>(null);
  const [queryInput, setQueryInput] = useState(query);
  const colsTriggerRef = useRef<HTMLButtonElement>(null);
  const colsPanelRef = useRef<HTMLDivElement>(null);
  const queryDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    setVisible(loadVisible());
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
    }
  }, [visible]);

  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      // The panel is portaled to <body> so a contains() check against the
      // trigger alone isn't enough — also exclude clicks inside the panel.
      if (colsTriggerRef.current?.contains(target)) return;
      if (colsPanelRef.current?.contains(target)) return;
      setColsOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Position the portaled panel under the trigger and keep it pinned as the
  // user scrolls or resizes. `useLayoutEffect` so the panel appears in place
  // on the first frame instead of flickering at (0, 0).
  useLayoutEffect(() => {
    if (!colsOpen) {
      setColsPos(null);
      return;
    }
    function place() {
      const el = colsTriggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setColsPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [colsOpen]);

  useEffect(() => {
    return () => {

      if (queryDebounceRef.current) {
        window.clearTimeout(queryDebounceRef.current);
        queryDebounceRef.current = null;
      }
    };
  }, []);

  function pushParams(updates: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    navigate(qs ? `${pathname}?${qs}` : pathname);
  }

  function setQuery(q: string) {
    setQueryInput(q);
    if (queryDebounceRef.current) window.clearTimeout(queryDebounceRef.current);
    queryDebounceRef.current = window.setTimeout(() => {
      pushParams({ q: q.trim() || undefined, page: undefined });
    }, 300);
  }

  function applySort(key: SortKey) {
    let nextDir: 'asc' | 'desc' = 'desc';
    if (sort.key === key) nextDir = sort.dir === 'asc' ? 'desc' : 'asc';
    pushParams({
      sort: key === 'timestamp' ? undefined : key,
      dir: nextDir === 'desc' ? undefined : nextDir,
      page: undefined,
    });
  }

  function setPage(n: number) {
    pushParams({ page: n > 0 ? String(n + 1) : undefined });
  }

  const qs = params.toString();

  // Which calls belong to a turn depends on the date/model/project filters, so
  // anything already fetched is stale the moment they move. Sort/search/page
  // are in the same string and don't affect it — dropping the cache on those
  // too costs one refetch of a row the user has to re-open anyway.
  useEffect(() => {
    setExpanded(new Set());
    setChildrenById({});
  }, [qs]);

  const loadChildren = useCallback(
    async (turnId: string, offset: number) => {
      const sp = new URLSearchParams(qs);
      for (const k of ['q', 'sort', 'dir', 'page', 'gran']) sp.delete(k);
      sp.set('turnId', turnId);
      sp.set('offset', String(offset));
      sp.set('limit', String(CHILDREN_PAGE_SIZE));

      setChildrenById((prev) => ({
        ...prev,
        [turnId]: { items: prev[turnId]?.items ?? [], total: prev[turnId]?.total ?? 0, loading: true },
      }));
      try {
        const res = await fetch(`/api/turns/children?${sp.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { children: UsageTableRow[]; total: number };
        setChildrenById((prev) => {
          const before = prev[turnId]?.items ?? [];
          // `offset === 0` is a fresh open, anything else appends. Guarding on
          // the length keeps a double-click from duplicating a page.
          const items =
            offset === 0
              ? data.children
              : before.length === offset
                ? [...before, ...data.children]
                : before;
          return { ...prev, [turnId]: { items, total: data.total, loading: false } };
        });
      } catch (err) {
        setChildrenById((prev) => ({
          ...prev,
          [turnId]: {
            items: prev[turnId]?.items ?? [],
            total: prev[turnId]?.total ?? 0,
            loading: false,
            error: (err as Error).message,
          },
        }));
      }
    },
    [qs],
  );

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        if (!childrenById[id]) void loadChildren(id, 0);
      }
      return next;
    });
  }

  function exportCsv() {
    const sp = new URLSearchParams(params.toString());
    window.location.href = `/api/export/usage?${sp.toString()}`;
  }

  const activeColumns = COLUMNS.filter((c) => visible[c.id]);
  const colSpan = activeColumns.length + 1;
  const visibleCount = activeColumns.length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <input
          value={queryInput}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('common.searchPlaceholder')}
          className="px-3 py-1.5 text-sm rounded-button border border-border bg-bg-surface focus:outline-none focus:border-border-hi w-72 placeholder:text-text-tertiary text-text-primary"
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-tertiary tabular-nums">
            {t('common.rows', { count: totalCount.toLocaleString() })}
          </span>
          <div className="relative">
            <button
              ref={colsTriggerRef}
              onClick={() => setColsOpen((o) => !o)}
              className="btn"
              aria-haspopup="dialog"
              aria-expanded={colsOpen}
            >
              {t('usage.columns.button')}
              <span className="ml-1 text-text-tertiary tabular-nums">{visibleCount}</span>
            </button>
            {/*
              Portaled to <body> so the Section card's `overflow-hidden` can't
              clip it when the table is short (e.g. filter yields ~0 rows).
              `useLayoutEffect` keeps it pinned to the trigger as the user
              scrolls or resizes.
            */}
            {colsOpen && colsPos &&
              typeof document !== 'undefined' &&
              createPortal(
                <div
                  ref={colsPanelRef}
                  className="fixed w-56 card border-border-hi shadow-lg p-2 z-50"
                  style={{ top: colsPos.top, right: colsPos.right }}
                  role="dialog"
                >
                  <div className="flex items-center justify-between px-1.5 pb-1.5 mb-1 border-b border-border">
                    <span className="text-xs text-text-tertiary uppercase tracking-wide">
                      {t('usage.columns.title')}
                    </span>
                    <button
                      onClick={() => setVisible(defaultVisible())}
                      className="text-xs text-text-tertiary hover:text-text-primary"
                    >
                      {t('usage.columns.reset')}
                    </button>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    {COLUMNS.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-1.5 py-1.5 text-sm rounded hover:bg-bg-surface-hi cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={!!visible[c.id]}
                          onChange={(e) =>
                            setVisible((prev) => ({ ...prev, [c.id]: e.target.checked }))
                          }
                          className="accent-brand"
                        />
                        <span className="text-text-secondary">{t(c.labelKey)}</span>
                      </label>
                    ))}
                  </div>
                </div>,
                document.body,
              )}
          </div>
          <button onClick={exportCsv} className="btn">
            {t('common.exportCsv')}
          </button>
        </div>
      </div>
      <div
        className={cn(
          'card overflow-hidden transition-opacity',
          pending && 'opacity-60 cursor-progress pointer-events-none',
        )}
        aria-busy={pending}
      >
        <ScrollShadows>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-surface-hi/30">
                <Th>
                  <span className="sr-only">expand</span>
                </Th>
                {activeColumns.map((c) => (
                  <Th
                    key={c.id}
                    align={c.align}
                    sorted={c.sortKey ? sort.key === c.sortKey : false}
                    dir={sort.dir}
                    onClick={c.sortKey ? () => applySort(c.sortKey!) : undefined}
                  >
                    {t(c.labelKey)}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((turn) => {
                const isOpen = expanded.has(turn.turnId);
                const userText = turn.userText.trim() || t('usage.turn.noPrompt');
                return (
                  <RowsForTurn
                    key={turn.turnId}
                    turn={turn}
                    isOpen={isOpen}
                    onToggle={() => toggleExpand(turn.turnId)}
                    childState={childrenById[turn.turnId]}
                    onLoadMore={() =>
                      loadChildren(turn.turnId, childrenById[turn.turnId]?.items.length ?? 0)
                    }
                    userText={userText}
                    expandLabel={t('usage.turn.expand')}
                    collapseLabel={t('usage.turn.collapse')}
                    activeColumns={activeColumns}
                    locale={locale}
                    t={t}
                    codexFastActive={codexFastActive}
                  />
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-8 text-center text-text-tertiary text-sm">
                    {t('common.noMatchingRows')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollShadows>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-text-secondary">
          <span>{t('common.pageOf', { page: page + 1, total: pageCount })}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(0)} disabled={page === 0} className="btn-ghost disabled:opacity-40">
              {t('common.first')}
            </button>
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
              className="btn-ghost disabled:opacity-40"
            >
              {t('common.prev')}
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= pageCount - 1}
              className="btn-ghost disabled:opacity-40"
            >
              {t('common.next')}
            </button>
            <button
              onClick={() => setPage(pageCount - 1)}
              disabled={page >= pageCount - 1}
              className="btn-ghost disabled:opacity-40"
            >
              {t('common.last')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function RowsForTurn({
  turn,
  isOpen,
  onToggle,
  childState,
  onLoadMore,
  userText,
  expandLabel,
  collapseLabel,
  activeColumns,
  locale,
  t,
  codexFastActive,
}: {
  turn: UsageTurnSummary;
  isOpen: boolean;
  onToggle: () => void;
  childState?: ChildState;
  onLoadMore: () => void;
  userText: string;
  expandLabel: string;
  collapseLabel: string;
  activeColumns: ColumnDef[];
  locale: Locale;
  t: Translator;
  codexFastActive: boolean;
}) {
  const baseModel =
    turn.models.length === 1
      ? shortenModel(turn.models[0])
      : `${shortenModel(turn.models[0])} +${turn.models.length - 1}`;

  const effortSuffix = turn.efforts.length
    ? turn.efforts.length === 1
      ? ` · ${turn.efforts[0]}`
      : ` · ${turn.efforts[0]}+${turn.efforts.length - 1}`
    : '';
  const modelLabel = baseModel + effortSuffix;
  const toolsLabel = turn.toolNames.length
    ? turn.toolNames.slice(0, 3).join(', ') + (turn.toolNames.length > 3 ? '…' : '')
    : '—';

  const hasMoreChildren = !!childState && childState.items.length < childState.total;

  return (
    <>
      <tr
        className="border-b border-border last:border-b-0 hover:bg-bg-surface-hi/40 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-2 py-2 text-text-tertiary w-6 text-center select-none">
          <span title={isOpen ? collapseLabel : expandLabel} className="inline-block w-4">
            {isOpen ? '▾' : '▸'}
          </span>
        </td>
        {activeColumns.map((c) => (
          <td
            key={c.id}
            className={cn('px-3 py-2', c.align === 'right' ? 'text-right' : 'text-left')}
          >
            {renderTurnCell(c.id, turn, modelLabel, toolsLabel, userText, locale, t, codexFastActive)}
          </td>
        ))}
      </tr>
      {isOpen && (
        <>
          {(childState?.items ?? []).map((r) => (
            <tr
              key={r.uuid}
              className="border-b border-border last:border-b-0 bg-bg-surface-hi/20 text-text-tertiary"
            >
              <td className="px-2 py-1.5 w-6"></td>
              {activeColumns.map((c) => (
                <td
                  key={c.id}
                  className={cn('px-3 py-1.5', c.align === 'right' ? 'text-right' : 'text-left')}
                >
                  {renderChildCell(c.id, r, turn.userText, locale, t, codexFastActive)}
                </td>
              ))}
            </tr>
          ))}
          {(childState?.loading || childState?.error || hasMoreChildren) && (
            <tr className="border-b border-border last:border-b-0 bg-bg-surface-hi/20">
              <td className="px-2 py-1.5 w-6"></td>
              <td colSpan={activeColumns.length} className="px-3 py-1.5 text-xs">
                {childState?.error ? (
                  <span className="text-warning">
                    {t('usage.turn.callsFailed', { error: childState.error })}
                  </span>
                ) : childState?.loading ? (
                  <span className="text-text-tertiary">{t('usage.turn.loadingCalls')}</span>
                ) : (
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoadMore();
                    }}
                  >
                    {t('usage.turn.loadMoreCalls', {
                      shown: childState?.items.length ?? 0,
                      total: childState?.total ?? 0,
                    })}
                  </button>
                )}
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

function renderTurnCell(
  id: ColumnId,
  turn: UsageTurnSummary,
  modelLabel: string,
  toolsLabel: string,
  userText: string,
  locale: Locale,
  t: Translator,
  codexFastActive: boolean,
): React.ReactNode {
  switch (id) {
    case 'time':

      return (
        <span
          className="num-mono text-text-secondary whitespace-nowrap text-xs"
          title={`started ${formatDateTime(turn.timestamp)}\nended   ${formatDateTime(turn.endTimestamp)}`}
        >
          {formatDateTime(turn.timestamp)}
        </span>
      );
    case 'duration':

      return (
        <span
          className="num-mono text-text-secondary whitespace-nowrap text-xs"
          title={`${formatDateTime(turn.timestamp)} → ${formatDateTime(turn.endTimestamp)}`}
        >
          {formatDuration(turn.durationMs)}
        </span>
      );
    case 'prompt':
      return (
        <HoverCard
          maxWidth={460}
          panelClassName="p-3 text-sm text-text-secondary leading-relaxed"
          content={<div className="whitespace-pre-wrap break-words">{userText}</div>}
        >
          <span className="block text-text-secondary truncate max-w-[280px]">{userText}</span>
        </HoverCard>
      );
    case 'model':
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-text-primary">
            {modelLabel}
            {codexFastActive && turn.source === 'codex' && (
              <span className="font-semibold text-warning" title={t('usage.badge.fastHint')}>
                {`·${t('usage.badge.fast')}`}
              </span>
            )}
          </span>
          {turn.hasWorkflowSubagents && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none bg-brand/10 text-brand border border-brand/20"
              title={t('usage.badge.workflowHint', { count: turn.workflowSubagentCount })}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
              </svg>
              {t('usage.badge.workflow')}
              {turn.workflowSubagentCount > 1 ? ` ×${turn.workflowSubagentCount}` : ''}
            </span>
          )}
        </span>
      );
    case 'project':
      return (
        <span className="block text-text-secondary truncate max-w-[180px]" title={turn.cwd}>
          {turn.projectLabel || projectNameFromCwd(turn.cwd)}
        </span>
      );
    case 'session':
      return (
        <span className="num-mono text-text-tertiary text-xs" title={turn.sessionId}>
          {shortHash(turn.sessionId)}
        </span>
      );
    case 'calls':
      return <span className="num-mono text-text-secondary">{turn.callCount}</span>;
    case 'input':
      return (
        <span className="num-mono text-text-secondary">
          {formatTokensCompact(turn.inputTokens, locale)}
        </span>
      );
    case 'output':
      return (
        <span className="num-mono text-text-secondary">
          {formatTokensCompact(turn.outputTokens, locale)}
        </span>
      );
    case 'cacheRead':
      return (
        <span className="num-mono text-success">{formatTokensCompact(turn.cacheReadTokens, locale)}</span>
      );
    case 'cacheWrite':
      return (
        <span className="num-mono text-text-secondary">
          {formatTokensCompact(turn.cacheCreationTokens, locale)}
        </span>
      );
    case 'total':
      return (
        <HoverCard
          align="right"
          maxWidth={300}
          panelClassName="p-0 overflow-hidden"
          content={<TokenBreakdown row={turn} locale={locale} t={t} />}
        >
          <span className="num-mono text-text-primary font-medium border-b border-dashed border-border hover:border-text-tertiary cursor-help">
            {formatTokensCompact(turn.totalTokens, locale)}
          </span>
        </HoverCard>
      );
    case 'cost':
      return (
        <span className="num-mono text-text-primary font-medium">
          {formatUSDPrecise(turn.cost)}
        </span>
      );
    case 'tools':
      return (
        <span
          className="block text-xs text-text-tertiary truncate max-w-[160px]"
          title={turn.toolNames.join(', ')}
        >
          {toolsLabel}
        </span>
      );
  }
}

function renderChildCell(
  id: ColumnId,
  r: UsageTableRow,
  turnPrompt: string,
  locale: Locale,
  t: Translator,
  codexFastActive: boolean,
): React.ReactNode {
  switch (id) {
    case 'time':

      return (
        <span className="num-mono whitespace-nowrap text-xs inline-block translate-x-5">
          {formatDateTime(r.timestamp)}
        </span>
      );
    case 'duration':

      return <span className="text-xs text-text-tertiary">—</span>;
    case 'prompt': {

      const direct = (r.directPrompt ?? '').trim();
      const showDirect = direct && direct !== turnPrompt.trim();
      if (showDirect) {
        return (
          <span
            className="block text-xs text-text-secondary truncate max-w-[320px]"
            title={direct}
          >
            {direct}
          </span>
        );
      }
      if (!r.toolNames.length) {
        return <span className="text-xs text-text-tertiary">—</span>;
      }
      const allTools = r.toolNames.join(', ');
      const toolDisplay =
        r.toolNames.slice(0, 3).join(', ') + (r.toolNames.length > 3 ? '…' : '');
      return (
        <span className="block text-xs text-text-secondary truncate max-w-[280px]" title={allTools}>
          {toolDisplay}
        </span>
      );
    }
    case 'model':
      return (
        <span className="whitespace-nowrap">
          {shortenModel(r.model)}
          {r.effort ? ` · ${r.effort}` : ''}
          {codexFastActive && r.source === 'codex' && (
            <span className="font-semibold text-warning" title={t('usage.badge.fastHint')}>
              {`·${t('usage.badge.fast')}`}
            </span>
          )}
        </span>
      );
    case 'project':
      return (
        <span className="block truncate max-w-[180px]" title={r.cwd}>
          {r.projectLabel || projectNameFromCwd(r.cwd)}
        </span>
      );
    case 'session':
      return (
        <span className="num-mono text-xs" title={r.sessionId}>
          {shortHash(r.sessionId)}
        </span>
      );
    case 'calls':
      return <span className="num-mono">1</span>;
    case 'input':
      return <span className="num-mono">{formatTokensCompact(r.inputTokens, locale)}</span>;
    case 'output':
      return <span className="num-mono">{formatTokensCompact(r.outputTokens, locale)}</span>;
    case 'cacheRead':
      return (
        <span className="num-mono text-success">{formatTokensCompact(r.cacheReadTokens, locale)}</span>
      );
    case 'cacheWrite':
      return <span className="num-mono">{formatTokensCompact(r.cacheCreationTokens, locale)}</span>;
    case 'total':
      return (
        <HoverCard
          align="right"
          maxWidth={300}
          panelClassName="p-0 overflow-hidden"
          content={<TokenBreakdown row={r} locale={locale} t={t} />}
        >
          <span className="num-mono border-b border-dashed border-border/60 hover:border-text-tertiary cursor-help">
            {formatTokensCompact(r.totalTokens, locale)}
          </span>
        </HoverCard>
      );
    case 'cost':
      return <span className="num-mono">{formatUSDPrecise(r.cost)}</span>;
    case 'tools':
      return (
        <span className="block text-xs truncate max-w-[160px]" title={r.toolNames.join(', ')}>
          {r.toolNames.length ? r.toolNames.join(', ') : '—'}
        </span>
      );
  }
}

type BreakdownInput = Pick<
  UsageTableRow & UsageTurnRow,
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheCreationTokens'
  | 'reasoningTokens'
  | 'totalTokens'
  | 'cost'
  | 'costInput'
  | 'costOutput'
  | 'costCacheRead'
  | 'costCacheWrite'
>;

function TokenBreakdown({
  row,
  locale,
  t,
}: {
  row: BreakdownInput;
  locale: Locale;
  t: Translator;
}) {
  const items: Array<{ key: string; label: string; tokens: number; cost: number; tone: string; dot: string }> = [
    {
      key: 'input',
      label: t('usage.col.input'),
      tokens: row.inputTokens,
      cost: row.costInput,
      tone: 'text-text-primary',
      dot: 'bg-chart-input',
    },
    {
      key: 'output',
      label: t('usage.col.output'),
      tokens: row.outputTokens,
      cost: row.costOutput,
      tone: 'text-text-primary',
      dot: 'bg-chart-output',
    },
    {
      key: 'cacheRead',
      label: t('usage.col.cacheRead'),
      tokens: row.cacheReadTokens,
      cost: row.costCacheRead,
      tone: 'text-success',
      dot: 'bg-chart-cache-read',
    },
    {
      key: 'cacheWrite',
      label: t('usage.col.cacheWrite'),
      tokens: row.cacheCreationTokens,
      cost: row.costCacheWrite,
      tone: 'text-text-primary',
      dot: 'bg-chart-cache-create',
    },
  ];
  return (
    <div className="text-xs">
      <div className="px-3 py-2 border-b border-border bg-bg-surface-hi/40 text-text-tertiary uppercase tracking-wide font-medium">
        {t('usage.breakdown.title')}
      </div>
      <div className="px-3 py-2">
        <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 items-center">
          <span />
          <span className="text-text-tertiary text-[10px] uppercase tracking-wide text-right">
            {t('usage.breakdown.headerTokens')}
          </span>
          <span className="text-text-tertiary text-[10px] uppercase tracking-wide text-right">
            {t('usage.breakdown.headerCost')}
          </span>
          {items.map((it) => (
            <Fragment key={it.key}>
              <span className="inline-flex items-center gap-2 text-text-secondary">
                <span className={cn('w-2 h-2 rounded-sm', it.dot)} />
                {it.label}
              </span>
              <span className={cn('num-mono text-right', it.tone)}>
                {formatTokensCompact(it.tokens, locale)}
              </span>
              <span className="num-mono text-right text-text-secondary">
                {formatUSDPrecise(it.cost)}
              </span>
              {it.key === 'output' && row.reasoningTokens > 0 && (
                <Fragment key="reasoning-detail">
                  <span className="inline-flex items-center gap-2 text-text-tertiary pl-4 text-[11px]">
                    <span className="text-text-tertiary">↳</span>
                    {t('usage.breakdown.reasoning')}
                  </span>
                  <span className="num-mono text-right text-text-tertiary text-[11px]">
                    {formatTokensCompact(row.reasoningTokens, locale)}
                  </span>
                  <span className="text-right text-text-tertiary text-[11px]">
                    {t('usage.breakdown.reasoningNote')}
                  </span>
                </Fragment>
              )}
            </Fragment>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-border grid grid-cols-[auto_1fr_auto] gap-x-3 items-center">
          <span className="text-text-secondary font-medium">{t('usage.breakdown.total')}</span>
          <span className="num-mono text-right text-text-primary font-medium">
            {formatTokensCompact(row.totalTokens, locale)}
          </span>
          <span className="num-mono text-right text-text-primary font-medium">
            {formatUSDPrecise(row.cost)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  align = 'left',
  sorted,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  sorted?: boolean;
  dir?: 'asc' | 'desc';
  onClick?: () => void;
}) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wide whitespace-nowrap',
        align === 'right' ? 'text-right' : 'text-left',
        onClick && 'cursor-pointer hover:text-text-primary select-none',
      )}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sorted && <span className="text-[10px]">{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
}
