import { Skeleton, SkeletonStat, SkeletonCard } from '@/components/ui/Skeleton';

/**
 * Analytics loading skeleton — mirrors the analytics page: a title + subtitle,
 * three headline metric tiles, and a chart card below.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-5xl"
      role="status"
      aria-label="Loading analytics"
    >
      <div className="mb-6">
        <Skeleton className="mb-2 h-8 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>

      <div className="mt-6">
        <SkeletonCard className="h-72" />
      </div>

      <span className="sr-only">Loading analytics…</span>
    </div>
  );
}
