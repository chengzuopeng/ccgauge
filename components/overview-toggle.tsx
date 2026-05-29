'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import {
  USAGE_OVERVIEW_HIDDEN_KEY,
  USAGE_OVERVIEW_DATA_ATTR,
  USAGE_OVERVIEW_HIDDEN_VALUE,
} from '@/lib/storage-keys';

export function OverviewToggle() {
  const t = useT();
  const [hidden, setHidden] = useState<boolean>(false);

  useEffect(() => {
    setHidden(
      document.documentElement.getAttribute(USAGE_OVERVIEW_DATA_ATTR) ===
        USAGE_OVERVIEW_HIDDEN_VALUE,
    );
  }, []);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem(USAGE_OVERVIEW_HIDDEN_KEY, next ? '1' : '0');
    } catch {

    }
    if (next) {
      document.documentElement.setAttribute(
        USAGE_OVERVIEW_DATA_ATTR,
        USAGE_OVERVIEW_HIDDEN_VALUE,
      );
    } else {
      document.documentElement.removeAttribute(USAGE_OVERVIEW_DATA_ATTR);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!hidden}
      title={hidden ? t('usage.overview.show') : t('usage.overview.hide')}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-button text-xs font-medium',
        'border transition-colors duration-150',
        hidden
          ? 'border-border bg-bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-surface-hi'
          : 'border-brand/40 bg-brand/12 text-brand hover:bg-brand/20 hover:border-brand/60',
      )}
    >
      <Eye open={!hidden} />
      <span className="hidden sm:inline">{t('usage.overview.label')}</span>
    </button>
  );
}

function Eye({ open }: { open: boolean }) {

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {open ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
          <path d="M10.73 5.08A11 11 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      )}
    </svg>
  );
}
