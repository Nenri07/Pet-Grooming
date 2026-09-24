import Link from 'next/link';

/**
 * Global 404 page.
 *
 * Rendered by Next.js for unmatched routes and whenever code calls
 * `notFound()` (e.g. a booking slug or pet card id that doesn't exist). Shows a
 * friendly, non-technical message and a link back to the home page rather than
 * a raw error (Requirement 21.4).
 *
 * _Requirements: 21.4_
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <p className="mb-2 text-5xl font-bold text-base-content/30">404</p>
      <h2 className="mb-2 text-xl font-semibold text-base-content">
        Page not found
      </h2>
      <p className="mb-6 max-w-md text-base-content/60">
        We couldn&apos;t find the page you were looking for. It may have moved or
        no longer exists.
      </p>
      <Link href="/" className="btn btn-primary min-h-[44px]">
        Back to home
      </Link>
    </div>
  );
}
