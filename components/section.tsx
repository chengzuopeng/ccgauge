import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface SectionProps {
  title?: string;
  desc?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Render the description inline next to the title (default: stacked below). */
  inlineDesc?: boolean;
  /** Make the inner content area grow to fill the section (for equal-height rows). */
  fillBody?: boolean;
}

export function Section({
  title,
  desc,
  right,
  children,
  className,
  inlineDesc,
  fillBody,
}: SectionProps) {
  return (
    // No vertical margin baked in here — let the parent layout (PageShell's
    // `space-y-*`, grid `gap-*`, or an explicit `mt-*` in `className`)
    // control spacing. Sections used as the root of a stretched flex/grid
    // cell rely on starting at y=0 so siblings line up.
    <section className={cn('card overflow-hidden', fillBody && 'flex flex-col', className)}>
      {(title || right) && (
        <header
          className={cn(
            'section-header',
            'flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4',
            'px-5 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-border',
          )}
        >
          <div className={cn('min-w-0', inlineDesc && 'sm:flex sm:items-baseline sm:gap-2.5')}>
            {title && (
              <h2 className="text-[15px] font-semibold text-text-primary tracking-tight leading-tight">
                {title}
              </h2>
            )}
            {desc && (
              <p
                className={cn(
                  'text-xs text-text-secondary leading-relaxed',
                  inlineDesc ? 'mt-1 sm:mt-0' : 'mt-1.5',
                )}
              >
                {desc}
              </p>
            )}
          </div>
          {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
        </header>
      )}
      <div className={cn('p-5 sm:p-6', fillBody && 'flex-1 flex flex-col')}>{children}</div>
    </section>
  );
}

export function PageShell({
  title,
  desc,
  right,
  children,
}: {
  title: string;
  desc?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    // `dash-stagger`: each top-level block settles in on first mount and on
    // route navigation. It does NOT replay on the background auto-refresh —
    // `router.refresh()` keeps these DOM nodes mounted, so the CSS entrance
    // animation only fires on a real (re)mount. Honors reduced-motion.
    <div className="dash-stagger max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-[1.75rem] font-semibold tracking-tight leading-tight truncate">
            {title}
          </h1>
          {desc && <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">{desc}</p>}
        </div>
        {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  desc,
  icon,
  action,
}: {
  title: string;
  desc?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card text-center py-14 sm:py-16 px-6 flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-bg-surface-hi border border-border flex items-center justify-center text-text-tertiary">
        {icon ?? <DefaultEmptyIcon />}
      </div>
      <div className="text-base font-medium text-text-primary">{title}</div>
      {desc && <div className="text-sm text-text-tertiary max-w-md leading-relaxed">{desc}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function DefaultEmptyIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h.01M15 9h.01M9 15c1 1 2 1.5 3 1.5s2-.5 3-1.5" />
    </svg>
  );
}
