/**
 * Portal segment loading boundary.
 *
 * Next.js renders this while an async Server Component under `(portal)` is
 * still resolving its data (e.g. a DB round-trip). Providing a Suspense
 * fallback here is REQUIRED for streaming SSR: without it, an async portal
 * page that suspends during the server render can abort the stream with React
 * error #419 ("the server did not finish this Suspense boundary"), which
 * surfaced as the "error occurred in the Server Components render" crash on
 * data-heavy pages like /pets. A calm, theme-tokened skeleton keeps the shell
 * stable while the page resolves.
 */
export default function PortalLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse p-1" aria-hidden="true">
      <div className="mb-6 h-8 w-48 rounded-box bg-base-200" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 rounded-box bg-base-200" />
        ))}
      </div>
    </div>
  );
}
