import * as React from 'react';

/**
 * Skeleton — loading placeholder shown while data is being fetched.
 *
 * Requirements:
 * - 19.3: WHILE data is being fetched for a view, display a loading skeleton
 *   placeholder within 200ms of fetch initiation until the data loads or an
 *   error occurs.
 *
 * This is a pure presentational component with no data dependencies, so it is
 * display-ready the instant it is rendered (well within the 200ms budget).
 * It uses DaisyUI's `skeleton` utility with a pulse animation.
 */

type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Optional explicit width (Tailwind class or CSS value via style). */
  width?: string | number;
  /** Optional explicit height (Tailwind class or CSS value via style). */
  height?: string | number;
  /** Render as a circle (e.g. avatar placeholder). */
  circle?: boolean;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function Skeleton({
  className,
  width,
  height,
  circle = false,
  style,
  ...rest
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'skeleton animate-pulse bg-base-300',
        circle ? 'rounded-full' : 'rounded-2xl',
        className
      )}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
}

interface SkeletonTextProps {
  /** Number of text lines to render. */
  lines?: number;
  className?: string;
}

/** Convenience helper that renders several skeleton text lines. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cx('h-4 rounded-lg', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

/** Convenience helper that renders a card-shaped skeleton block. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cx('rounded-2xl bg-base-100 p-4 shadow-card', className)}>
      <div className="flex items-center gap-3">
        <Skeleton circle className="h-12 w-12" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2 rounded-lg" />
          <Skeleton className="h-3 w-1/3 rounded-lg" />
        </div>
      </div>
      <SkeletonText lines={2} className="mt-4" />
    </div>
  );
}

export default Skeleton;
