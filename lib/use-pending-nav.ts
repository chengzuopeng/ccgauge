'use client';

import { useEffect, useReducer, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Shared navigation primitive used by every filter control on the dashboard
 * (range picker, segmented pickers, multi-selects, table sort/page/search,
 * source switcher). Wraps `router.push` in `useTransition` so each filter
 * click yields **immediate visual feedback** instead of a frozen UI while the
 * server re-renders.
 *
 * Consumers should style themselves with `aria-busy={pending}` plus
 * `opacity-60 cursor-progress` while `pending`, so the user sees the click
 * landed even before the new server payload arrives.
 */
export function usePendingNav() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // Same-route navigations (searchParams-only, so no loading.tsx boundary is
  // involved) lose their wake-up on Next 15.5 roughly 40% of the time: the RSC
  // response lands in ~50ms and the suspended transition is simply never
  // re-attempted, so the click sits frozen until ANY state update re-renders
  // the tree. Measured: a stuck nav commits ~40ms after an unrelated setState
  // — using the response it already had, no refetch — and without one it
  // outlives a 45s timeout; cross-route navs commit their loading fallback
  // immediately and never stall. Re-rendering on a short interval while
  // pending turns a lost wake-up into one ~200ms tick. No-op when the nav
  // commits normally (pending clears, interval dies after 0-1 cheap bumps).
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(bump, 200);
    return () => window.clearInterval(id);
  }, [pending]);

  function navigate(href: string) {
    startTransition(() => {
      router.push(href);
    });
  }
  return { pending, navigate };
}
