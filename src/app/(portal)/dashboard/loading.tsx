import { Skeleton, SkeletonStat, SkeletonCard } from '@/components/ui/Skeleton';

/**
 * Dashboard loading skeleton — mirrors the bento dashboard: a title, a row of
 * stat tiles (this-month summary) and a couple of larger cards for the route /
 * radar panels.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl" role="status" aria-label="Loading dashboard">
      <Skeleton className="mb-6 h-8 w-48" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>

      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}
