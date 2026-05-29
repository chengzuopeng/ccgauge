'use client';

import { cn } from '@/lib/utils';
import type { TabRect } from '@/components/use-tab-indicator';

interface Props {
  rect: TabRect | null;
  variant?: 'pill' | 'underline';
  className?: string;
}

export function TabIndicator({ rect, variant = 'pill', className }: Props) {
  if (!rect) return null;
  const inset = variant === 'underline' ? 8 : 0;
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute transition-[transform,width] duration-200 ease-out-soft',
        variant === 'pill'
          ? 'inset-y-0 rounded bg-brand-strong shadow-sm'
          : '-bottom-[12px] h-[2px] rounded-full bg-brand',
        className,
      )}
      style={{
        transform: `translateX(${rect.left + inset}px)`,
        width: Math.max(0, rect.width - inset * 2),
      }}
    />
  );
}
