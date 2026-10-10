'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/context';
import type { IndexerProgress } from '@/lib/data-loader/indexer';

const POLL_MS = 1000;

interface StatusPayload {
  initialized: boolean;
  progress: IndexerProgress;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}

export function IndexStatusBanner() {
  const t = useT();
  const router = useRouter();
  const [progress, setProgress] = useState<IndexerProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let sawRefresh = false;
    let busyPolls = 0;

    async function poll() {
      try {
        const res = await fetch('/api/scan/status', { cache: 'no-store' });
        const body = (await res.json()) as StatusPayload;
        if (cancelled) return;
        const p = body.progress;
        if (body.initialized && p.phase === 'idle') {
          setProgress(null);
          if (sawRefresh) {
            router.refresh();
            window.dispatchEvent(new Event('ccgauge:refresh'));
          }
          return;
        }
        if (p.phase === 'refreshing') {
          sawRefresh = true;
          setProgress(p);
        } else if (p.phase === 'indexing' && p.filesTotal > 0) {
          busyPolls += 1;
          if (busyPolls >= 2) setProgress(p);
        }
      } catch {
        if (cancelled) return;
      }
      timer = window.setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [router]);

  if (!progress) return null;

  const message =
    progress.phase === 'indexing'
      ? t('index.indexing')
      : progress.reason === 'backfill'
        ? t('index.backfilling', { total: progress.filesTotal })
        : t('index.refreshing', { total: progress.filesTotal });
  const pct =
    progress.bytesTotal > 0
      ? progress.bytesDone / progress.bytesTotal
      : progress.filesTotal > 0
        ? progress.filesDone / progress.filesTotal
        : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
      <div role="status" className="card px-4 py-3 text-sm text-text-secondary">
        <div className="flex items-start gap-2.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand animate-pulse" aria-hidden />
          <span className="min-w-0 flex-1">{message}</span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-surface-hi">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </div>
          <span className="num-mono shrink-0 text-xs text-text-tertiary">
            {t('index.counter', {
              done: progress.filesDone,
              total: progress.filesTotal,
              doneSize: formatSize(progress.bytesDone),
              totalSize: formatSize(progress.bytesTotal),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
