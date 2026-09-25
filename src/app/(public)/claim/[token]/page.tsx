import type { Metadata } from 'next';
import { resolveClaim } from '@/lib/fill';
import { ClaimView } from '@/components/public/ClaimView';

/**
 * Public claim page — /claim/[token] (Master Spec §11.1).
 *
 * Server component: resolves the Fill My Day claim token to the slot + groomer
 * branding, then renders the client {@link ClaimView} with a Claim button. On
 * confirm the winner is booked (first-to-win); losers see "just taken".
 *
 * Claim pages are noindex — they are private, single-use links.
 *
 * _Master Spec: §11.1_
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Claim your spot',
  robots: { index: false, follow: false },
};

export default async function ClaimPage({ params }: { params: { token: string } }) {
  const claim = await resolveClaim(params.token);

  return (
    <main className="min-h-screen bg-base-200 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        {claim ? (
          <ClaimView
            token={claim.token}
            business={claim.business}
            logoUrl={claim.logoUrl ?? null}
            startMs={claim.startMs}
            endMs={claim.endMs}
            timezone={claim.timezone}
            petName={claim.petName ?? null}
            alreadyTaken={claim.alreadyTaken}
          />
        ) : (
          <div className="rounded-box border border-base-content/10 bg-base-100 p-8 text-center shadow-card">
            <h1 className="text-2xl font-bold text-base-content">Link expired</h1>
            <p className="mt-3 text-base-content/70">
              This offer has expired or the slot is no longer available. Reach out to
              your groomer to book another time.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
