import type { Metadata } from 'next';
import Link from 'next/link';
import { loadOwnStripe } from '@/lib/stripe/own-account';
import { confirmOwnStripeCheckout } from '@/lib/stripe/own-checkout';
import { PaidBookingView } from '@/components/booking/PaidBookingView';

/**
 * Return page after a card deposit on the groomer's own Stripe account.
 * Confirms the Checkout Session with Stripe server-side and shows the receipt.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Booking confirmed', robots: { index: false, follow: false } };

export default async function PaidPage({
  params,
  searchParams,
}: {
  params: { groomerSlug: string };
  searchParams: { session_id?: string };
}) {
  const slug = params.groomerSlug;
  const sessionId = typeof searchParams.session_id === 'string' ? searchParams.session_id : '';
  const own = sessionId ? await loadOwnStripe({ groomerSlug: slug }) : null;
  const result = own ? await confirmOwnStripeCheckout(own, sessionId) : null;

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto w-full max-w-xl px-4 py-10">{children}</main>
  );

  if (result?.ok) {
    return shell(<PaidBookingView summary={result.summary} />);
  }

  const processing = Boolean(result && 'pending' in result && result.pending);
  return shell(
    <div className="flex flex-col gap-4 text-center">
      <h1 className="text-xl font-semibold text-base-content">
        {processing ? 'Payment processing' : 'We couldn\u2019t confirm this payment'}
      </h1>
      <p className="text-sm text-base-content/70">
        {processing
          ? 'Your payment is being processed. You\u2019ll get a confirmation email as soon as it clears.'
          : 'If you were charged, your groomer can see the payment and will confirm your booking. Otherwise, please try booking again.'}
      </p>
      <Link href={`/book/${encodeURIComponent(slug)}`} className="btn btn-outline min-h-[44px]">
        Back to booking
      </Link>
    </div>
  );
}
