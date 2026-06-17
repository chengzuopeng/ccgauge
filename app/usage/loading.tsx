import { PageShell, Section } from '@/components/section';

/**
 * Shown by Next while /usage suspends. Phase 2 also renders client-side
 * skeletons inside the page itself once the route is loaded, so this file
 * mostly covers cold-load / hard-navigation cases — but it still matters as
 * the very first thing the user sees when clicking into the page.
 */
export default function Loading() {
  return (
    <PageShell title="" desc="">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonKpi key={i} />
        ))}
      </div>
      <Section title="" className="mt-4">
        <div className="h-64 m-4 rounded-card bg-bg-surface-hi/40 animate-pulse" />
      </Section>
      <Section title="">
        <div className="p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-7 rounded bg-bg-surface-hi/40 animate-pulse" />
          ))}
        </div>
      </Section>
    </PageShell>
  );
}

function SkeletonKpi() {
  return (
    <div className="card p-4">
      <div className="h-3 w-24 rounded bg-bg-surface-hi/40 animate-pulse" />
      <div className="h-7 w-28 mt-3 rounded bg-bg-surface-hi/60 animate-pulse" />
    </div>
  );
}
