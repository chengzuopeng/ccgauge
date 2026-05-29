'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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

  useIsomorphicLayoutEffect(() => {
    measure();
  }, [measure]);

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
