/**
 * Booking deposits on a groomer's OWN Stripe account (Stripe Checkout).
 *
 * Flow: the client confirms → we place a short slot hold, store the full
 * booking as a PendingBooking keyed by the Checkout Session id, and send the
 * client to Stripe's hosted checkout on the groomer's account. The booking is
 * created only once Stripe says the session is paid: on the return page and
 * by the per-groomer webhook (whichever comes first; fulfilment is idempotent).
 *
 * Server-only.
 */
import type Stripe from 'stripe';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { PendingBooking } from '@/lib/db/models/pending-booking';
import { createHold, SlotHeldError } from '@/lib/calendar/holds';
import { isRedisConfigured } from '@/lib/redis';
import { generateBookingRef } from '@/lib/booking/reference';
import { fulfilBookingByPaymentIntentId, type FulfilResult } from '@/lib/booking/fulfil';
import { appBaseUrl, loadOwnStripe, type OwnStripeAccount } from '@/lib/stripe/own-account';
import type { DepositMetadata } from '@/lib/stripe/helpers';

const DAY = 24 * 60 * 60 * 1000;
/** Stripe's minimum Checkout lifetime is 30 minutes. */
const CHECKOUT_TTL_SEC = 30 * 60;

export type StartCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

export async function startOwnStripeCheckout(
  groomerSlug: string,
  booking: DepositMetadata
): Promise<StartCheckoutResult> {
  if (!groomerSlug || !booking?.pet || !booking?.owner?.email || !booking.owner.address) {
    return { ok: false, error: 'Missing booking details.' };
  }
  const startMs = Date.parse(booking.slotStart);
  const now = Date.now();
  if (!Number.isFinite(startMs) || startMs < now - DAY || startMs > now + 730 * DAY) {
    return { ok: false, error: 'Invalid appointment time.' };
  }

  await connectDB();
  const profile = await GroomerProfile.findOne({ groomerSlug })
    .select('userId depositAmount businessName')
    .lean<{ userId: unknown; depositAmount?: number; businessName?: string } | null>();
  if (!profile) return { ok: false, error: 'This groomer is unavailable.' };
  const amount = typeof profile.depositAmount === 'number' ? profile.depositAmount : 0;
  if (!(amount > 0)) return { ok: false, error: 'No deposit is needed for this booking.' };

  const own = await loadOwnStripe({ groomerSlug });
  if (!own) return { ok: false, error: 'This groomer isn\u2019t taking card payments right now.' };

  // Short hold so nobody else books the slot mid-checkout (best-effort).
  let holdId: string | undefined;
  const endMs = booking.slotEnd ? Date.parse(booking.slotEnd) : NaN;
  if (isRedisConfigured() && Number.isFinite(endMs) && endMs > startMs) {
    try {
      const hold = await createHold(String(profile.userId), startMs, endMs, booking.owner.email.toLowerCase());
      holdId = hold.holdId;
    } catch (err) {
      if (err instanceof SlotHeldError) {
        return { ok: false, error: 'That time was just taken. Please pick another.' };
      }
      console.error('[own-checkout] hold failed (continuing):', err);
    }
  }

  const bookingRef = generateBookingRef();
  const base = appBaseUrl();
  const when = new Date(startMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  let session: Stripe.Checkout.Session;
  try {
    session = await own.stripe.checkout.sessions.create({
      mode: 'payment',
      // Cards (incl. Apple Pay / Google Pay) settle instantly, so the booking
      // can be confirmed the moment the client returns.
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: `Booking deposit \u2014 ${own.businessName}`.slice(0, 250),
              description: `${booking.pet.name} \u00b7 ${when} \u00b7 Ref ${bookingRef}`.slice(0, 250),
            },
          },
        },
      ],
      customer_email: booking.owner.email,
      success_url: `${base}/book/${encodeURIComponent(groomerSlug)}/paid?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/book/${encodeURIComponent(groomerSlug)}?deposit=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SEC,
      metadata: { pawxis: '1', groomerSlug, bookingRef },
      payment_intent_data: {
        description: `Pawxis booking ${bookingRef}`,
        metadata: { pawxis: '1', groomerSlug, bookingRef },
      },
    });
  } catch (err) {
    console.error('[own-checkout] session create failed:', (err as Error).message);
    return { ok: false, error: 'Card payment is unavailable right now. Please try again shortly.' };
  }
  if (!session.url) return { ok: false, error: 'Card payment is unavailable right now.' };

  await PendingBooking.create({
    paymentIntentId: session.id,
    groomerId: profile.userId,
    groomerSlug,
    pet: booking.pet,
    owner: booking.owner,
    slotStart: booking.slotStart,
    slotEnd: booking.slotEnd,
    serviceId: booking.serviceId,
    smsConsent: booking.smsConsent === true,
    holdId,
    bookingRef,
  });

  return { ok: true, url: session.url };
}

export type ConfirmCheckoutResult = FulfilResult | { ok: false; pending: true; error: string };

const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]+$/;

/** Create the booking for a paid Checkout Session (idempotent). */
export async function confirmOwnStripeCheckout(
  own: OwnStripeAccount,
  sessionId: string
): Promise<ConfirmCheckoutResult> {
  if (!SESSION_ID.test(sessionId)) return { ok: false, error: 'Payment not found.' };
  let session: Stripe.Checkout.Session;
  try {
    session = await own.stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  } catch {
    return { ok: false, error: 'Payment not found.' };
  }
  if (session.metadata?.pawxis !== '1' || session.metadata?.groomerSlug !== own.groomerSlug) {
    return { ok: false, error: 'Payment not found.' };
  }
  if (session.payment_status !== 'paid') {
    return { ok: false, pending: true, error: 'Your payment is still processing.' };
  }
  let pi = session.payment_intent;
  if (typeof pi === 'string') {
    try {
      pi = await own.stripe.paymentIntents.retrieve(pi);
    } catch {
      return { ok: false, error: 'We couldn\u2019t read the payment. Your groomer will confirm it.' };
    }
  }
  if (!pi) return { ok: false, error: 'Payment not found.' };
  return fulfilBookingByPaymentIntentId(pi, { pendingKey: session.id });
}
