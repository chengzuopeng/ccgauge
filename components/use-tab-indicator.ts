'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * `useLayoutEffect` warns when run during SSR. These controls are client
 * components but Next still server-renders their initial HTML, so fall back
 * to `useEffect` on the server to keep the console clean while preserving
 * pre-paint measurement on the client.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Drives a single "moving indicator" (sliding pill / underline) across a
 * row of tab-like buttons of varying widths — the i18n labels differ
 * between EN/ZH so we can't assume equal widths, hence we measure.
 *
 * Usage:
 *   const { containerRef, rect } = useTabIndicator(activeId);
 *   <div ref={containerRef} className="relative ...">
 *     {rect && <span style={{ transform:`translateX(${rect.left}px)`, width: rect.left===rect.left?rect.width:0 }} />}
 *     <button data-tab="a">…</button>
 *   </div>
 *
 * Measurement uses `offsetLeft`/`offsetWidth` relative to the container
 * (which must be the indicator's `position: relative` offset parent).
 * Those are scroll-independent, so it also works inside a horizontally
 * scrollable nav.
 *
 * Returns `rect = null` until the first measurement lands, so callers can
 * skip rendering the indicator (avoids a flash at 0,0 before hydration
 * measures the active tab).
 */
export interface TabRect {
  left: number;
  width: number;
}

export function useTabIndicator<T extends HTMLElement>(activeId: string) {
  const containerRef = useRef<T | null>(null);
  const [rect, setRect] = useState<TabRect | null>(null);

  const measure = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    // activeId values are simple (hrefs / slugs), no quotes — safe to inline.
    const el = c.querySelector<HTMLElement>(`[data-tab="${activeId}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    setRect((prev) => {
      const next = { left: el.offsetLeft, width: el.offsetWidth };
      if (prev && prev.left === next.left && prev.width === next.width) return prev;
      return next;
    });
  }, [activeId]);

  // Measure synchronously after layout so the pill is correct on first paint
  // (post-hydration).
  useIsomorphicLayoutEffect(() => {
    measure();
  }, [measure]);

  // Re-measure when the container or its contents resize (font swap, viewport
  // change, label width change on locale switch).
  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(c);
    for (const child of Array.from(c.children)) ro.observe(child);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return { containerRef, rect };
}
