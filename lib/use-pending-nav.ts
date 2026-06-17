'use client';

import { useTransition } from 'react';
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
  function navigate(href: string) {
    startTransition(() => {
      router.push(href);
    });
  }
  return { pending, navigate };
}
