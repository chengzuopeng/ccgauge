import { KpiSkeleton } from '@/components/kpi-card';

export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div className="space-y-2">
        <div className="skeleton-shimmer h-7 w-48 rounded" />
        <div className="skeleton-shimmer h-4 w-72 rounded" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      <div className="card card-pad min-h-[280px]">
        <div className="skeleton-shimmer h-full min-h-[232px] w-full rounded" />
      </div>
    </div>
  );
}
