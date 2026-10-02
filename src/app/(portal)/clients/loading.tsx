import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

/**
 * Clients loading skeleton — a title, a search bar, and a stacked list of
 * client cards mirroring {@link ClientListView}.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-4xl"
      role="status"
      aria-label="Loading clients"
    >
      <Skeleton className="mb-6 h-8 w-40" />

      <Skeleton className="mb-4 h-11 w-full" />

      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <span className="sr-only">Loading clients…</span>
    </div>
  );
}
