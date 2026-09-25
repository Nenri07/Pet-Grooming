'use server';

/**
 * Webhook-independent booking finalisation.
 *
 * The Stripe webhook (`payment_intent.succeeded`) is the authoritative point at
 * which a booking is persisted — but it only fires when the webhook is actually
 * configured and reachable on the host. On a fresh deploy (or local dev) that
 * is often NOT the case, which is the "booking not saving" symptom.
 *
 * This server action lets the CLIENT trigger the same fulfilment from the
 * success step: given a succeeded PaymentIntent id it idempotently ensures the
 * booking is persisted and returns the shared booking reference + a display
 * summary. It calls the SAME {@link fulfilBookingByPaymentIntentId} core the
 * webhook uses, so both are guarded by the Transaction unique index and can
 * never double-create — whichever runs first wins, the other returns the
 * already-persisted record.
 *
 * When Stripe is configured we first verify the PaymentIntent is genuinely
 * `succeeded` (so a client can't finalise an unpaid booking). When Stripe is
 * NOT configured (dev / no secret key) we cannot verify — the action returns a
 * clear result and the success screen falls back to local state with a
 * generated reference.
 *
 * _Requirements: 7.3, 7.5, 7.6_
 */
import type Stripe from 'stripe';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import {
  fulfilBookingByPaymentIntentId,
  type FulfilSummary,
} from '@/lib/booking/fulfil';

/** Result envelope returned by {@link finalizeBookingByPaymentIntent}. */
export type FinalizeResult =
  | {
      ok: true;
      /** Whether this call created the booking (vs. found an existing one). */
      created: boolean;
      bookingRef: string;
      summary: FulfilSummary;
    }
  | {
      ok: false;
      /** Machine-readable reason so the UI can choose its fallback. */
      reason: 'not_configured' | 'not_succeeded' | 'not_found' | 'error';
      error: string;
    };

/**
 * Idempotently ensure the booking for `paymentIntentId` is persisted.
 *
 * @param paymentIntentId the Stripe PaymentIntent id from the success step.
 */
export async function finalizeBookingByPaymentIntent(
  paymentIntentId: string
): Promise<FinalizeResult> {
  if (typeof paymentIntentId !== 'string' || paymentIntentId.length === 0) {
    return { ok: false, reason: 'not_found', error: 'Missing payment reference.' };
  }

  // Without a secret key we cannot verify the payment or reach the shared
  // fulfilment (which needs DB access anyway). Signal the dev/no-Stripe case so
  // the success screen renders the ticket from local state (Req 7.6).
  if (!isStripeConfigured()) {
    return {
      ok: false,
      reason: 'not_configured',
      error: 'Payment verification is unavailable in this environment.',
    };
  }

  try {
    const stripe = getStripe();

    // Verify the intent actually succeeded before persisting anything — a
    // client must not be able to finalise an unpaid or failed booking.
    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (retrieveErr) {
      console.error(
        `finalizeBookingByPaymentIntent: retrieve failed for ${paymentIntentId}:`,
        retrieveErr
      );
      return {
        ok: false,
        reason: 'not_found',
        error: 'We could not verify this payment. Please contact the groomer.',
      };
    }

    if (paymentIntent.status !== 'succeeded') {
      return {
        ok: false,
        reason: 'not_succeeded',
        error: 'This payment has not completed yet.',
      };
    }

    // Run the shared, idempotent fulfilment. Safe to race the webhook: the
    // Transaction unique index guarantees exactly one commit.
    const result = await fulfilBookingByPaymentIntentId(paymentIntent);
    if (!result.ok) {
      return { ok: false, reason: 'not_found', error: result.error };
    }

    return {
      ok: true,
      created: result.created,
      bookingRef: result.summary.bookingRef,
      summary: result.summary,
    };
  } catch (error) {
    console.error('finalizeBookingByPaymentIntent failed:', error);
    return {
      ok: false,
      reason: 'error',
      error: 'We could not finalize your booking right now. Please try again.',
    };
  }
}
