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
 * Stripe Connect direct charges (Phase 3, task 13.2; design "Stripe Flows (e)"):
 * the deposit PaymentIntent is created as a DIRECT CHARGE on the groomer's
 * connected account (`{ stripeAccount: acct_… }`, i.e. the `Stripe-Account`
 * header), so funds settle on the groomer's balance and Pawxis is NOT the MoR
 * (R16.4). The deposit path REQUIRES a `complete` Connected_Account (R16.1,
 * R17.1): when the groomer hasn't finished Connect we return a clear error
 * envelope WITHOUT creating a charge or a PendingBooking. Application-fee
 * plumbing is present but 0 at launch (R16.2) — see the fee-omit note at the
 * call site. The PendingBooking keyed by PI id and the fulfilment path are
 * UNCHANGED; `payment_intent.succeeded` for a direct charge arrives as a
 * CONNECT event (`event.account` set) which task 13.3 routes to the same
 * unchanged `fulfilBookingByPaymentIntentId`.
 *
 * _Requirements: 7.1, 7.2, 7.6, 16.1, 16.2, 16.4, 17.1_
 */
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile, type ConnectStatus } from '@/lib/db/models/groomer-profile';
import { PendingBooking } from '@/lib/db/models/pending-booking';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { createHold, SlotHeldError } from '@/lib/calendar/holds';
import { isRedisConfigured } from '@/lib/redis';
import { generateBookingRef } from '@/lib/booking/reference';
import { computeApplicationFee } from '@/lib/billing/fees';
import { getPlatformFeePercent } from '@/lib/billing/config';
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
  /**
   * Whether the client ticked the SMS-consent checkbox at booking step 2
   * (Master Spec §12.3). Threaded to the webhook so it can stamp
   * `Client.smsConsentAt`. Defaults to false (no consent) when omitted.
   */
  smsConsent?: boolean;
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
      /**
       * The human-friendly booking reference (e.g. `PP-7K3QW9`) minted here and
       * stored on the PendingBooking so the SAME reference is reused when the
       * booking is fulfilled and shown on the client's confirmation ticket.
       */
      bookingRef: string;
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
 * User-facing message when a deposit booking is attempted against a groomer who
 * has not completed Stripe Connect onboarding (R16.1 / R17.1). The deposit path
 * ALWAYS requires payment, so a non-`complete` account (or no account) blocks
 * the booking here with this labelled state rather than charging. (R17.2's
 * no-deposit booking is a separate path, gated on the booking page in task 14.2
 * — it never reaches this deposit-intent helper.)
 */
const CONNECT_NOT_READY_ERROR =
  "This groomer isn't able to accept online payments yet. Please contact them to book.";

/**
 * Resolve the groomer's EFFECTIVE Connect status for the deposit gate.
 *
 * Prefers the stored `connectStatus` enum (task 13.1) when present. For rows
 * written before `connectStatus` existed it falls back to a COARSE status
 * derived from the legacy `stripeConnectChargesEnabled` boolean
 * (`true` → treat as `complete`, else `not_started`), so legacy profiles still
 * gate correctly without a backfill. (The canonical status/charges mapping on
 * `account.updated` lives in `@/lib/billing/connect`; this is only the
 * read-side fallback.)
 */
function effectiveConnectStatus(profile: {
  connectStatus?: ConnectStatus;
  stripeConnectChargesEnabled?: boolean;
}): ConnectStatus {
  if (profile.connectStatus) return profile.connectStatus;
  return profile.stripeConnectChargesEnabled === true ? 'complete' : 'not_started';
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
      // Also pull the Connect fields so we can gate the deposit on a COMPLETE
      // connected account and target the direct charge at it (task 13.2).
      .select(
        'userId depositAmount stripeConnectAccountId connectStatus stripeConnectChargesEnabled'
      )
      .lean();

    if (!profile) {
      return {
        ok: false,
        error: "We couldn't start the payment because this groomer is unavailable.",
      };
    }

    // GATE (R16.1 / R17.1, refined R16.1/16.2): a deposit booking requires a
    // COMPLETE Connected_Account. If the groomer hasn't finished Connect (or
    // has no connected account id), block cleanly here — BEFORE placing any
    // Redis hold, creating a charge, or persisting a PendingBooking — with the
    // labelled "can't accept online payments yet" envelope. The deposit path
    // always requires payment, so there is no "pay later" fallback here;
    // R17.2's no-deposit booking is handled by the booking-page gate (task 14.2).
    const connectStatus = effectiveConnectStatus(profile);
    const connectAccountId = profile.stripeConnectAccountId;
    if (connectStatus !== 'complete' || !connectAccountId) {
      return { ok: false, error: CONNECT_NOT_READY_ERROR };
    }

    const amount = resolveDepositAmount(profile.depositAmount);
    const currency = 'usd';

    // Mint the human-friendly booking reference now so the SAME code is reused
    // on fulfilment (webhook OR client fallback) and shown on the confirmation
    // ticket. Persisted on the PendingBooking below.
    const bookingRef = generateBookingRef();

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

    const amountMinor = Math.round(amount * 100); // Stripe expects the smallest unit (cents).

    // Application-fee plumbing (R16.2): derive the fee from the configurable
    // platform rate (0 at launch ⇒ fee 0). The plumbing is PRESENT so a
    // non-zero percentage can be enabled by config alone, with no re-architecting.
    //
    // Fee-omit-when-0 decision: Stripe REJECTS `application_fee_amount: 0` on a
    // direct charge, so we OMIT the field entirely when the computed fee is 0
    // (the launch case) and INCLUDE it only when it is > 0. This keeps the
    // plumbing intact (the computation always runs) while producing a valid
    // request today.
    const applicationFeeAmount = computeApplicationFee(
      amountMinor,
      currency,
      getPlatformFeePercent()
    );

    // Create the deposit PaymentIntent as a DIRECT CHARGE on the groomer's
    // connected account via `{ stripeAccount: connectAccountId }` (the
    // `Stripe-Account` header). Funds settle on the groomer's balance; Pawxis
    // is not the MoR (R16.4). `payment_intent.succeeded` for this charge is
    // delivered as a CONNECT event (`event.account` set) and task 13.3 routes
    // it to the same unchanged `fulfilBookingByPaymentIntentId` (keyed by PI id).
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountMinor,
        currency,
        // Omit application_fee_amount when 0 (Stripe rejects a 0 fee); include
        // it only when > 0 so the fee routes to the platform once enabled.
        ...(applicationFeeAmount > 0
          ? { application_fee_amount: applicationFeeAmount }
          : {}),
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
      },
      { stripeAccount: connectAccountId }
    );

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
    //
    // The PendingBooking is keyed by the PI id REGARDLESS of which account the
    // intent lives on, so it stays unchanged for direct charges: fulfilment
    // (`fulfilBookingByPaymentIntentId`) also keys off the PI id. The connected
    // account id is not stored here because the webhook learns it from the
    // CONNECT event's `event.account` (task 13.3) and the lookup needs only the
    // PI id. The hold logic below is likewise unchanged.
    const pending = await PendingBooking.findOneAndUpdate(
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
          // SMS consent (§12.3) captured at booking step 2, threaded to the
          // webhook so it can stamp Client.smsConsentAt on fulfilment.
          smsConsent: booking.smsConsent === true,
          // Thread the hold id through so the webhook can release it + bust the
          // slot cache after fulfilment. Absent when no hold was placed.
          holdId,
        },
        $setOnInsert: {
          paymentIntentId: paymentIntent.id,
          createdAt: new Date(),
          // Set the reference only on INSERT so a retried intent-creation for
          // the same payment keeps the reference minted on the first call.
          bookingRef,
        },
      },
      // Return the (possibly pre-existing) stored document so we can echo back
      // the reference actually persisted — on a retry this is the first call's
      // reference, not the fresh one we generated this time.
      { upsert: true, new: true }
    );

    // Record the PaymentIntent id on the intent's own metadata too, so the
    // identifier is visible in the Stripe dashboard alongside the record.
    // This MUST target the connected account as well (`{ stripeAccount }`),
    // because the intent lives ON that account — a platform-scoped update would
    // not find it.
    await stripe.paymentIntents.update(
      paymentIntent.id,
      { metadata: { groomerId, groomerSlug, paymentIntentId: paymentIntent.id } },
      { stripeAccount: connectAccountId }
    );

    return {
      ok: true,
      clientSecret: paymentIntent.client_secret,
      amount,
      currency,
      bookingRef: pending?.bookingRef ?? bookingRef,
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
