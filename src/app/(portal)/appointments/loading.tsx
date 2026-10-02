import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

/**
 * Appointments loading skeleton — a title, a filter bar, and a stacked list of
 * appointment rows mirroring {@link AppointmentsList}.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-5xl"
      role="status"
      aria-label="Loading appointments"
    >
      <Skeleton className="mb-6 h-8 w-56" />

      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <span className="sr-only">Loading appointments…</span>
    </div>
  );
}
