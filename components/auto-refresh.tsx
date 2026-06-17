'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Props {

  intervalMs?: number;
}

export function AutoRefresh({ intervalMs = 15_000 }: Props) {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    if (intervalMs <= 0) return;

    let timer: number | null = null;

    function tick() {
      if (document.hidden || running.current) return;
      running.current = true;
      try {
        router.refresh();
        // Also nudge any data island on the current page to refetch — the
        // /usage page now renders most of its data via a client-side fetch
        // that doesn't pick up router.refresh() on its own.
        window.dispatchEvent(new Event('ccgauge:refresh'));
      } finally {

        Promise.resolve().then(() => {
          running.current = false;
        });
      }
    }

    timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);

    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, intervalMs]);

  return null;
}
