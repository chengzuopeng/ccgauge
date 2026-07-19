'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/context';
import type { PricingMeta } from '@/lib/pricing/pricing-meta';

// `fetchedLabel` is formatted on the server (which, for ccgauge, IS the user's own
// machine — so its locale/timezone are the right ones) and passed in, avoiding a
// client toLocaleString that would risk a hydration mismatch.
export function PricingRefresh({ meta, fetchedLabel }: { meta: PricingMeta; fetchedLabel: string | null }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/pricing/refresh', { method: 'POST', cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as { status?: string } | null;
      if (data?.status === 'refreshed') {
        setResult({ ok: true, msg: t('settings.pricing.refreshOk') });
        router.refresh();
      } else if (data?.status === 'offline') {
        setResult({ ok: false, msg: t('settings.pricing.offline') });
      } else {
        setResult({ ok: false, msg: t('settings.pricing.refreshFail') });
      }
    } catch {
      setResult({ ok: false, msg: t('settings.pricing.refreshFail') });
    } finally {
      setBusy(false);
    }
  }

  const sourceText =
    meta.source === 'cache'
      ? t('settings.pricing.sourceCache', { time: fetchedLabel ?? '' })
      : t('settings.pricing.sourceBuiltin');

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <span className="text-xs text-text-tertiary">
        {sourceText}
        {result && (
          <span className={result.ok ? 'ml-1.5 text-success' : 'ml-1.5 text-warning'}>
            · {result.msg}
          </span>
        )}
      </span>
      {meta.offline ? (
        <span className="text-xs text-text-tertiary">{t('settings.pricing.offline')}</span>
      ) : (
        <button onClick={refresh} disabled={busy} className="btn">
          {busy ? t('settings.pricing.refreshing') : t('settings.pricing.refresh')}
        </button>
      )}
    </div>
  );
}
