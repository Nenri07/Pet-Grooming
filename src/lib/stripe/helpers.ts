'use server';

/**
 * Stripe payment server actions for the booking flow.
 *
 * Backs Step 5 (deposit payment) of the public booking flow. The
 * {@link createDepositPaymentIntent} action resolves the deposit amount for a
 * groomer, creates a Stripe PaymentIntent (in cents, with automatic payment
 * methods enabled), and returns the client secret the browser needs to mount
 * the Payment Element.
 *
 * Deposit-amount resolution (decision locked in for task 6.9):
 *   groomer profile `depositAmount` (when set) ?? env `DEPOSIT_AMOUNT_USD` ?? 50
 *
 * The action RETURNS a typed result envelope rather than throwing, so the UI
 * can distinguish "here is your client secret" from "payment is temporarily
 * unavailable" (Requirement 7.6) and degrade gracefully when Stripe is not
 * configured (missing secret key).
 *
 * The FULL booking context (groomer slug, complete pet + owner, and the slot
 * ISO timestamps) is persisted server-side in a {@link PendingBooking} keyed
 * by the PaymentIntent id, and only small identifiers (groomerId, groomerSlug,
 * paymentIntentId) are attached to the PaymentIntent metadata. This is because
 * a Stripe metadata VALUE is capped at 500 characters, which the full booking
 * payload exceeds — so the webhook (task 6.10) reconstructs and persists the
 * booking on `payment_intent.succeeded` by looking up the PendingBooking
 * instead of parsing metadata.
 *
 * _Requirements: 7.1, 7.2, 7.6_
 */
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { PendingBooking } from '@/lib/db/models/pending-booking';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { createHold, SlotHeldError } from '@/lib/calendar/holds';
import { isRedisConfigured } from '@/lib/redis';
import type { OwnerDetailsInput, PetInfoInput } from '@/types';

/** Hard fallback deposit if neither the profile nor the env configure one. */
const FALLBACK_DEPOSIT_USD = 50;

/**
 * Full booking context the client passes so the webhook can reconstruct and
 * persist the appointment on payment success. This is the authoritative shape
 * — it carries the COMPLETE pet and owner records (not summaries), which is
 * why it is persisted in a PendingBooking rather than on Stripe metadata.
 */
export interface DepositMetadata {
  /** Complete pet details captured in Step 1. */
  pet: PetInfoInput;
  /** Complete owner + service-address details captured in Step 2. */
  owner: OwnerDetailsInput;
  /** Selected slot start, ISO-8601. */
  slotStart: string;
  /** Selected slot end, ISO-8601. */
  slotEnd?: string;
  /** Optional explicit service id the client is booking. */
  serviceId?: string;
}

/** Result envelope returned by {@link createDepositPaymentIntent}. */
export type CreateDepositResult =
  | {
      ok: true;
      /** The PaymentIntent client secret used to mount the Payment Element. */
      clientSecret: string;
      /** The resolved deposit amount, in whole currency units (e.g. USD). */
      amount: number;
      /** ISO 4217 currency code (lowercase, e.g. "usd"). */
      currency: string;
    }
  | { ok: false; error: string };

/** Read and sanitize the global default deposit from the environment. */
function envDepositUsd(): number {
  const raw = Number(process.env.DEPOSIT_AMOUNT_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_DEPOSIT_USD;
}

/**
 * Whether a value is a usable, non-negative finite monetary amount. A deposit
 * of exactly 0 is allowed by the schema (min 0), but we only PREFER the profile
 * value when it is a positive amount; a 0/undefined profile falls back to env.
 */
function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the deposit amount to charge for a groomer:
 * profile.depositAmount (when a positive value) ?? DEPOSIT_AMOUNT_USD ?? 50.
 */
function resolveDepositAmount(profileDeposit: unknown): number {
  if (isPositiveFinite(profileDeposit)) return profileDeposit;
  return envDepositUsd();
}

/**
 * Create a Stripe PaymentIntent for a groomer's booking deposit.
 *
 * @param groomerSlug the groomer's public booking slug.
 * @param booking the FULL booking context (pet, owner, slot) persisted as a
 *   PendingBooking so the webhook can reconstruct the appointment.
 * @returns a result envelope with the client secret + resolved amount, or an
 *          error message when Stripe is unavailable / the groomer is unknown.
 */
export async function createDepositPaymentIntent(
  groomerSlug: string,
  booking: DepositMetadata
): Promise<CreateDepositResult> {
  // Degrade gracefully when the server secret key is not configured — the code
  // must still build and run so it works once the key is added (Req 7.6).
  if (!isStripeConfigured()) {
    return {
      ok: false,
      error:
        'Online payment is temporarily unavailable. Please try again shortly or contact the groomer.',
    };
  }

  if (!groomerSlug) {
    return {
      ok: false,
      error: "We couldn't start the payment because this booking link is invalid.",
    };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ groomerSlug })
      .select('userId depositAmount')
      .lean();

    if (!profile) {
      return {
        ok: false,
        error: "We couldn't start the payment because this groomer is unavailable.",
      };
    }

    const amount = resolveDepositAmount(profile.depositAmount);
    const currency = 'usd';

    const groomerId = profile.userId.toString();

    // Best-effort: place a 10-minute Redis hold on the selected slot BEFORE
    // charging, so a concurrent client can't book the same time mid-checkout
    // (Master Spec §9.4). The hold id is threaded onto the PendingBooking and
    // released by the webhook after fulfilment.
    //
    // Degradation rules (must never break checkout):
    //  - No Redis / no valid slot times → skip the hold, proceed to payment.
    //    The authoritative commit-time re-check in Mongo still prevents
    //    double-booking, so correctness is preserved without the early guard.
    //  - Slot already held (SlotHeldError) → return a clear conflict so the UI
    //    can refresh availability instead of charging for a taken slot.
    let holdId: string | undefined;
    const slotStartMs = Date.parse(booking.slotStart);
    const slotEndMs = booking.slotEnd ? Date.parse(booking.slotEnd) : NaN;
    if (
      isRedisConfigured() &&
      Number.isFinite(slotStartMs) &&
      Number.isFinite(slotEndMs) &&
      slotEndMs > slotStartMs
    ) {
      try {
        const hold = await createHold(
          groomerId,
          slotStartMs,
          slotEndMs,
          booking.owner.email.toLowerCase()
        );
        holdId = hold.holdId;
      } catch (holdErr) {
        if (holdErr instanceof SlotHeldError) {
          return {
            ok: false,
            error: 'That time slot was just taken. Please choose another and try again.',
          };
        }
        // Any other hold error is non-fatal — proceed without the early guard.
        console.error('createDepositPaymentIntent: hold creation failed:', holdErr);
      }
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe expects the smallest unit (cents).
      currency,
      // Only small identifiers live on Stripe metadata; the full pet+owner+slot
      // payload is persisted in the PendingBooking below (Stripe caps each
      // metadata VALUE at 500 chars, which the full booking exceeds).
      metadata: {
        groomerId,
        groomerSlug,
        // paymentIntentId is added below once the intent id is known — Stripe
        // exposes it as `intent.id`, so we set it via a follow-up update only
        // if needed. We instead key the PendingBooking on intent.id directly.
      },
      automatic_payment_methods: { enabled: true },
    });

    if (!paymentIntent.client_secret) {
      return {
        ok: false,
        error:
          'Online payment is temporarily unavailable. Please try again shortly or contact the groomer.',
      };
    }

    // Persist the FULL booking context server-side, keyed by the PaymentIntent
    // id, so the webhook can reconstruct the booking on success without relying
    // on (size-limited) Stripe metadata. Upsert keeps this idempotent if the
    // client retries intent creation for the same payment.
    await PendingBooking.findOneAndUpdate(
      { paymentIntentId: paymentIntent.id },
      {
        $set: {
          groomerId: profile.userId,
          groomerSlug,
          pet: booking.pet,
          owner: booking.owner,
          slotStart: booking.slotStart,
          slotEnd: booking.slotEnd,
          serviceId: booking.serviceId,
          // Thread the hold id through so the webhook can release it + bust the
          // slot cache after fulfilment. Absent when no hold was placed.
          holdId,
        },
        $setOnInsert: { paymentIntentId: paymentIntent.id, createdAt: new Date() },
      },
      { upsert: true }
    );

    // Record the PaymentIntent id on the intent's own metadata too, so the
    // identifier is visible in the Stripe dashboard alongside the record.
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: { groomerId, groomerSlug, paymentIntentId: paymentIntent.id },
    });

    return {
      ok: true,
      clientSecret: paymentIntent.client_secret,
      amount,
      currency,
    };
  } catch (error) {
    console.error('createDepositPaymentIntent failed:', error);
    return {
      ok: false,
      error:
        'Online payment is temporarily unavailable. Please try again shortly or contact the groomer.',
    };
  }
}
