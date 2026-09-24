'use client';

/**
 * Global error boundary — the last-resort fallback.
 *
 * Next.js renders this only when the root layout itself throws (a failure the
 * segment-level `error.tsx` boundaries can't catch). Because it replaces the
 * root layout, it MUST render its own `<html>` and `<body>`. It shows the same
 * friendly, non-technical message and a "Try again" button wired to `reset()`
 * (Requirement 21.4).
 *
 * _Requirements: 21.4_
 */

import * as React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[global] Unhandled error:', error);
  }, [error]);

  return (
    <html lang="en" data-theme="pawport_light">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            textAlign: 'center',
            fontFamily:
              'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          }}
        >
          <h2 style={{ marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>
            Something went wrong
          </h2>
          <p style={{ marginBottom: '1.5rem', maxWidth: '28rem', opacity: 0.7 }}>
            We couldn&apos;t complete that operation. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: '44px',
              padding: '0 1.25rem',
              borderRadius: '1rem',
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
