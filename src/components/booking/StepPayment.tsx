'use client';

import * as React from 'react';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import type { BookingStepProps } from '@/hooks/useBookingFlow';
import type { PaymentResult } from '@/types';
import {
  createDepositPaymentIntent,
  type DepositMetadata,
} from '@/lib/stripe/helpers';

/**
 * StepPayment — Step 5 of the booking flow (Stripe deposit payment).
 *
 * Behaviour (Requirements 7.1, 7.2, 7.4, 7.6, 7.7):
 *  - Loads Stripe.js with the publishable key from
 *    `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. When that key is empty (the current
 *    state of `.env` until the user adds `pk_test_...`), the component shows a
 *    clear "payment temporarily unavailable" message instead of crashing, so
 *    it starts working the moment the key is supplied (Req 7.6).
 *  - On mount, calls the {@link createDepositPaymentIntent} server action to
 *    create a PaymentIntent and obtain a client secret, then mounts the Stripe
 *    Payment Element via <Elements> (Req 7.1, 7.2).
 *  - On success: dispatches PAYMENT_SUCCESS with a {@link PaymentResult}
 *    (advancing to the success step) (Req 7.3 boundary).
 *  - On failure: shows the Stripe error and allows retry up to 3 times; on the
 *    3rd exhausted attempt it shows BOTH the Stripe error AND a
 *    "please contact the groomer" message together (Req 7.4).
 *  - Stripe unavailable / a payment that exceeds a 30s timeout shows a
 *    temporary-unavailability message and allows retry (Req 7.6).
 *  - If the tentative 10-minute slot reservation expires during payment, it
 *    cancels the attempt and returns the client to Step 4 via GO_TO_STEP(3)
 *    (Req 7.7).
 *  - Includes a Back button.
 *
 * _Requirements: 7.1, 7.2, 7.4, 7.6, 7.7_
 */

/** Max number of payment attempts before we surface the contact message. */
const MAX_PAYMENT_ATTEMPTS = 3;

/** How long a confirm attempt may run before we treat it as timed out (Req 7.6). */
const PAYMENT_TIMEOUT_MS = 30_000;

/** The tentative reservation lifetime that must not lapse mid-payment (Req 7.7). */
const RESERVATION_TTL_MS = 10 * 60 * 1000;

/** The publishable key, read from the public env at module load. */
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/**
 * Lazily create (once) the Stripe.js promise. Returns `null` when no
 * publishable key is configured so the UI can degrade gracefully (Req 7.6).
 */
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> | null {
  if (!PUBLISHABLE_KEY) return null;
  if (!stripePromise) {
    stripePromise = loadStripe(PUBLISHABLE_KEY);
  }
  return stripePromise;
}

/** Discriminated state for creating the PaymentIntent on mount. */
type IntentState =
  | { status: 'loading' }
  | { status: 'ready'; clientSecret: string; amount: number; currency: string }
  | { status: 'unavailable'; message: string };

/** A friendly message shown whenever the payment service can't be reached. */
const UNAVAILABLE_MESSAGE =
  'Online payment is temporarily unavailable. Please try again shortly.';

/** The contact-groomer message shown after retries are exhausted (Req 7.4). */
const CONTACT_GROOMER_MESSAGE =
  'We were unable to process your payment. Please contact the groomer directly to complete your booking.';

/**
 * Build the FULL booking context for the PaymentIntent. The server persists
 * this as a PendingBooking (keyed by the intent id) so the webhook can
 * reconstruct the appointment on payment success — hence we pass the complete
 * pet and owner records, not summaries. Returns `null` until every required
 * piece of state is present.
 */
function buildBookingContext(
  state: BookingStepProps['state']
): DepositMetadata | null {
  const owner = state.ownerDetails;
  const pet = state.petInfo;
  const slot = state.selectedSlot;
  if (!owner || !pet || !slot) return null;
  return {
    pet,
    owner,
    slotStart: new Date(slot.start).toISOString(),
    slotEnd: new Date(slot.end).toISOString(),
    // SMS consent captured at step 2 (Master Spec §12.3), threaded to the
    // deposit intent → webhook so Client.smsConsentAt is stamped on fulfilment.
    smsConsent: state.smsConsent === true,
  };
}

/**
 * Inner payment form. Rendered inside <Elements> so it can use the Stripe
 * hooks. Owns the retry counter, the 30s timeout, and the confirm call.
 */
function PaymentForm({
  state,
  dispatch,
  amount,
  currency,
}: {
  state: BookingStepProps['state'];
  dispatch: BookingStepProps['dispatch'];
  amount: number;
  currency: string;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [attempts, setAttempts] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [stripeError, setStripeError] = React.useState<string | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);

  // Reservation deadline: the 10-minute hold started when the slot was picked.
  // We approximate its start as this step's mount time (the transition from
  // Step 4 → 5 happens on selection), then guard against it lapsing (Req 7.7).
  const reservationDeadlineRef = React.useRef<number>(
    Date.now() + RESERVATION_TTL_MS
  );

  const attemptsExhausted = attempts >= MAX_PAYMENT_ATTEMPTS;

  /** Return the client to Step 4 to re-pick a slot when the hold lapses. */
  const handleReservationExpired = React.useCallback(() => {
    // GO_TO_STEP(3) targets the 0-based 'calendar' step (index 3) (Req 7.7).
    dispatch({ type: 'GO_TO_STEP', payload: 3 });
  }, [dispatch]);

  // If the reservation lapses while sitting on this step, bounce back to Step 4.
  React.useEffect(() => {
    const remaining = reservationDeadlineRef.current - Date.now();
    if (remaining <= 0) {
      handleReservationExpired();
      return;
    }
    const timer = setTimeout(handleReservationExpired, remaining);
    return () => clearTimeout(timer);
  }, [handleReservationExpired]);

  async function handlePay() {
    if (!stripe || !elements || submitting || attemptsExhausted) return;

    // Guard: don't attempt payment if the tentative hold has already lapsed.
    if (Date.now() >= reservationDeadlineRef.current) {
      handleReservationExpired();
      return;
    }

    setSubmitting(true);
    setStripeError(null);
    setUnavailable(false);

    // Race the confirm against a 30s timeout so a hung request surfaces a
    // temporary-unavailability message rather than spinning forever (Req 7.6).
    let timedOut = false;
    const timeout = new Promise<'timeout'>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve('timeout');
      }, PAYMENT_TIMEOUT_MS);
    });

    try {
      const confirm = stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });

      const outcome = await Promise.race([confirm, timeout]);

      if (outcome === 'timeout') {
        setUnavailable(true);
        return;
      }

      // Not a timeout: it's the Stripe confirm result.
      const { error, paymentIntent } = outcome as Awaited<typeof confirm>;

      if (error) {
        // A payment failure counts as a used attempt (Req 7.4).
        setAttempts((n) => n + 1);
        setStripeError(
          error.message ?? 'Your payment could not be processed. Please try again.'
        );
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        const result: PaymentResult = {
          paymentIntentId: paymentIntent.id,
          status: 'succeeded',
          amount,
          currency: currency.toUpperCase(),
        };
        dispatch({ type: 'PAYMENT_SUCCESS', payload: result });
        return;
      }

      // Any other terminal-ish status: treat as a failed attempt.
      setAttempts((n) => n + 1);
      setStripeError(
        'Your payment could not be completed. Please try a different payment method.'
      );
    } catch {
      if (timedOut) {
        setUnavailable(true);
      } else {
        setUnavailable(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const formattedAmount = (() => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency.toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  })();

  return (
    <div className="flex flex-col gap-4">
      <PaymentElement />

      {/* Temporary unavailability / timeout (Req 7.6). */}
      {unavailable && (
        <div className="alert alert-warning rounded-2xl" role="alert">
          <span>{UNAVAILABLE_MESSAGE}</span>
        </div>
      )}

      {/* Stripe error message (Req 7.4). Always shown when present. */}
      {stripeError && (
        <div className="alert alert-error rounded-2xl" role="alert">
          <span>{stripeError}</span>
        </div>
      )}

      {/* After the 3rd exhausted attempt, show the contact message TOGETHER
          with the Stripe error above (Req 7.4). */}
      {attemptsExhausted && (
        <div className="alert alert-error rounded-2xl" role="alert">
          <span>{CONTACT_GROOMER_MESSAGE}</span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary rounded-btn"
        onClick={() => void handlePay()}
        disabled={!stripe || !elements || submitting || attemptsExhausted}
      >
        {submitting ? (
          <>
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            Processing…
          </>
        ) : (
          `Pay deposit ${formattedAmount}`
        )}
      </button>

      {!attemptsExhausted && attempts > 0 && !submitting && (
        <p className="text-center text-xs text-base-content/50">
          Attempt {attempts} of {MAX_PAYMENT_ATTEMPTS}. You can try again.
        </p>
      )}
    </div>
  );
}

export function StepPayment({ state, dispatch, groomerSlug }: BookingStepProps) {
  const [intent, setIntent] = React.useState<IntentState>({ status: 'loading' });
  const stripePromise = React.useMemo(() => getStripePromise(), []);

  // Snapshot the full booking context so the effect deps stay stable. We
  // memoize on the underlying VALUES buildBookingContext reads, not on the
  // whole reducer `state` object (which changes identity every render). The
  // pet/owner references are stable while sitting on Step 5 (the reducer only
  // replaces them on SUBMIT actions), and the slot times are serialized to
  // primitive ISO strings so the memo is stable across re-renders. This breaks
  // the render → setIntent → new booking identity → effect re-fire loop.
  const pet = state.petInfo;
  const owner = state.ownerDetails;
  const slotStartISO = state.selectedSlot
    ? new Date(state.selectedSlot.start).toISOString()
    : null;
  const slotEndISO = state.selectedSlot
    ? new Date(state.selectedSlot.end).toISOString()
    : null;
  const booking = React.useMemo(
    () => buildBookingContext(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pet, owner, slotStartISO, slotEndISO]
  );

  const createIntent = React.useCallback(async () => {
    if (!booking) {
      setIntent({ status: 'unavailable', message: UNAVAILABLE_MESSAGE });
      return;
    }
    setIntent({ status: 'loading' });
    try {
      const result = await createDepositPaymentIntent(groomerSlug, booking);
      if (result.ok) {
        setIntent({
          status: 'ready',
          clientSecret: result.clientSecret,
          amount: result.amount,
          currency: result.currency,
        });
      } else {
        setIntent({ status: 'unavailable', message: result.error });
      }
    } catch {
      setIntent({ status: 'unavailable', message: UNAVAILABLE_MESSAGE });
    }
  }, [groomerSlug, booking]);

  React.useEffect(() => {
    // No publishable key → degrade gracefully, never crash (Req 7.6).
    if (!stripePromise) {
      setIntent({ status: 'unavailable', message: UNAVAILABLE_MESSAGE });
      return;
    }
    // Missing booking state (shouldn't happen at Step 5) → degrade gracefully.
    if (!booking) {
      setIntent({ status: 'unavailable', message: UNAVAILABLE_MESSAGE });
      return;
    }
    let cancelled = false;
    setIntent({ status: 'loading' });
    createDepositPaymentIntent(groomerSlug, booking)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setIntent({
            status: 'ready',
            clientSecret: result.clientSecret,
            amount: result.amount,
            currency: result.currency,
          });
        } else {
          setIntent({ status: 'unavailable', message: result.error });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setIntent({ status: 'unavailable', message: UNAVAILABLE_MESSAGE });
      });
    return () => {
      cancelled = true;
    };
  }, [stripePromise, groomerSlug, booking]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-base-content">Secure your booking</h2>
        <p className="text-sm text-base-content/60">
          Step 5 of 5 — Deposit payment
        </p>
      </div>

      <div className="min-h-24">
        {intent.status === 'loading' && (
          <div
            className="flex items-center gap-3 text-base-content/70"
            role="status"
            aria-live="polite"
          >
            <span className="loading loading-spinner loading-md" aria-hidden="true" />
            <span>Setting up secure payment…</span>
          </div>
        )}

        {intent.status === 'unavailable' && (
          <div className="flex flex-col gap-3">
            <div className="alert alert-warning rounded-2xl" role="alert">
              <span>{intent.message}</span>
            </div>
            {/* Retry is only meaningful when Stripe.js could actually load. */}
            {stripePromise && (
              <button
                type="button"
                className="btn btn-outline rounded-btn self-start"
                onClick={() => void createIntent()}
              >
                Try again
              </button>
            )}
          </div>
        )}

        {intent.status === 'ready' && stripePromise && (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: intent.clientSecret,
              appearance: { theme: 'stripe' },
            }}
          >
            <PaymentForm
              state={state}
              dispatch={dispatch}
              amount={intent.amount}
              currency={intent.currency}
            />
          </Elements>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-ghost rounded-btn"
          onClick={() => dispatch({ type: 'GO_BACK' })}
        >
          Back
        </button>
      </div>
    </div>
  );
}

export default StepPayment;
