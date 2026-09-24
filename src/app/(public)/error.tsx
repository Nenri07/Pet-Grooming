'use client';

/**
 * Public segment error boundary.
 *
 * Renders when a component under `(public)` (booking flow, pet card, etc.)
 * throws during render. Shows a friendly, non-technical message and a
 * "Try again" button wired to `reset()` (Requirement 21.4). Error detail is
 * logged, never shown to the visitor.
 *
 * _Requirements: 21.4_
 */

import * as React from 'react';

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[public] Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <h2 className="mb-2 text-xl font-semibold text-base-content">
        Something went wrong
      </h2>
      <p className="mb-6 max-w-md text-base-content/60">
        We couldn&apos;t load this page. Please try again in a moment.
      </p>
      <button
        type="button"
        className="btn btn-primary min-h-[44px]"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  );
}
