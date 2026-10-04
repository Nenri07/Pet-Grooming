'use client';

/**
 * Portal segment error boundary.
 *
 * Next.js renders this whenever a Server/Client Component under `(portal)`
 * throws during render. It shows a friendly, non-technical message and a
 * "Try again" button that calls `reset()` to re-attempt rendering the segment
 * (Requirement 21.4). Full error detail is logged to the console (server + client)
 * rather than shown to the user.
 *
 * _Requirements: 21.4_
 */

import * as React from 'react';

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Log detail for diagnostics; never surface it to the user.
    console.error('[portal] Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
      <h2 className="mb-2 text-xl font-semibold text-base-content">
        Something went wrong
      </h2>
      <p className="mb-6 max-w-md text-base-content/60">
        We couldn&apos;t complete that operation. Please try again.
      </p>
      <button
        type="button"
        className="btn btn-primary min-h-[44px]"
        onClick={() => reset()}
      >
        Try again
      </button>
      {/* Correlation id so a masked production error can be matched to the
          server log; the message is only shown outside production. */}
      {error.digest && (
        <p className="mt-4 font-mono text-xs text-base-content/40">
          Ref: {error.digest}
        </p>
      )}
      {process.env.NODE_ENV !== 'production' && error.message && (
        <pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap text-left font-mono text-xs text-error">
          {error.message}
        </pre>
      )}
    </div>
  );
}
