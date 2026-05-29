'use client';

import { useState } from 'react';
import { BlockProgress } from '@/components/block-progress';
import type { SerializedProgress } from '@/lib/serialize';
import type { ProviderId } from '@/lib/providers/types';

interface BlockSlot {
  source: ProviderId;
  label: string;

  cliName: string;

  initial: SerializedProgress;
}

interface Props {
  slots: BlockSlot[];

  defaultSource: ProviderId;
  className?: string;
}

export function BlockProgressSwitcher({ slots, defaultSource, className }: Props) {
  const initialIdx = Math.max(
    0,
    slots.findIndex((s) => s.source === defaultSource),
  );
  const [activeIdx, setActiveIdx] = useState(initialIdx);
  const active = slots[activeIdx] ?? slots[0];

  return (
    <BlockProgress
      initial={active.initial}

      sourceLabel={active.label}
      cliName={active.cliName}
      className={className}
      headerRight={
        <div
          role="tablist"
          aria-label="Active 5h block source"
          className="inline-flex items-center rounded-md border border-border bg-bg-surface p-0.5 gap-0.5"
        >
          {slots.map((slot, i) => {
            const isActive = i === activeIdx;
            return (
              <button
                key={slot.source}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveIdx(i)}
                className={`px-2 h-5 text-[11px] inline-flex items-center rounded transition-all ${
                  isActive
                    ? 'bg-brand-strong text-white font-semibold shadow-sm'
                    : 'text-text-tertiary font-medium hover:text-text-primary hover:bg-bg-surface-hi'
                }`}
              >
                {slot.label}
              </button>
            );
          })}
        </div>
      }
    />
  );
}
