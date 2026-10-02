import * as React from 'react';

/**
 * Skeleton — loading placeholder shown while data is being fetched.
 *
 * Requirements:
 * - 19.3: WHILE data is being fetched for a view, display a loading skeleton
 *   placeholder within 200ms of fetch initiation until the data loads or an
 *   error occurs.
 *
 * These are pure presentational components with no data dependencies, so they
 * are display-ready the instant they render (well within the 200ms budget).
 *
 * All visuals use DaisyUI theme tokens only (no hardcoded colours). The pulse
 * animation is disabled under `prefers-reduced-motion` via Tailwind's
 * `motion-reduce:animate-none` utility.
 */

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Optional explicit width (Tailwind class or CSS value via style). */
  width?: string | number;
  /** Optional explicit height (Tailwind class or CSS value via style). */
  height?: string | number;
  /** Render as a circle (e.g. avatar placeholder). */
  circle?: boolean;
};

/**
 * Base shimmer block. Renders a pulsing surface using theme tokens. The pulse
 * is suppressed when the user prefers reduced motion.
 */
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
        'animate-pulse bg-base-300/60 motion-reduce:animate-none',
        circle ? 'rounded-full' : 'rounded-box',
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

/** Renders several skeleton text bars of varying width; the last is `w-2/3`. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  const widths = ['w-full', 'w-11/12', 'w-10/12', 'w-9/12'];
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cx(
            'h-4',
            i === lines - 1 ? 'w-2/3' : widths[i % widths.length]
          )}
        />
      ))}
    </div>
  );
}

/** A Card-like surface placeholder: a title bar above a block of text lines. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'rounded-box border border-base-content/10 bg-base-100 p-4',
        className
      )}
    >
      <Skeleton className="mb-4 h-5 w-1/2" />
      <SkeletonText lines={3} />
    </div>
  );
}

/** A small stat tile placeholder: a label bar above a big number bar. */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'rounded-box border border-base-content/10 bg-base-100 p-4',
        className
      )}
    >
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="h-8 w-20" />
    </div>
  );
}

export default Skeleton;
