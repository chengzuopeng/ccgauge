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

export function IndexStatusBanner() {
  const t = useT();
  const router = useRouter();
  const [progress, setProgress] = useState<IndexerProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let refreshed = false;

    async function poll() {
      try {
        const res = await fetch('/api/scan/status', { cache: 'no-store' });
        const body = (await res.json()) as StatusPayload;
        if (cancelled) return;
        if (body.initialized && body.progress.phase === 'idle') {
          setProgress(null);
          if (refreshed) {
            router.refresh();
            window.dispatchEvent(new Event('ccgauge:refresh'));
          }
          return;
        }
        if (body.progress.phase !== 'idle') {
          refreshed = true;
          setProgress(body.progress);
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

  const pct = progress.filesTotal > 0 ? progress.filesDone / progress.filesTotal : 0;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
      <div role="status" className="card px-4 py-3 text-sm text-text-secondary">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-brand animate-pulse" aria-hidden />
          <span className="min-w-0 flex-1">{t('index.refreshing', { total: progress.filesTotal })}</span>
          <span className="num-mono shrink-0 text-text-tertiary">
            {progress.filesDone} / {progress.filesTotal}
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-bg-surface-hi">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
