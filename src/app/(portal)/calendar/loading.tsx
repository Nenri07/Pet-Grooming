import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Calendar loading skeleton — a title, a week-navigation bar, and a grid that
 * approximates the week view's day columns.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-6xl"
      role="status"
      aria-label="Loading calendar"
    >
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="rounded-box border border-base-content/10 bg-base-100 p-3"
          >
            <Skeleton className="mb-3 h-4 w-16" />
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Loading calendar…</span>
    </div>
  );
}
