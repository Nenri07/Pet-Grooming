'use server';

/**
 * No-deposit booking finalisation.
 *
 * This is the Stripe-free counterpart to `finalizeBookingByPaymentIntent`
 * (`src/actions/booking-finalize.ts`). When a groomer requires no deposit the
 * flow never creates a PaymentIntent nor a PendingBooking, so there is no
 * payment-driven path to persist the booking. The success step calls this
 * action instead, which builds a {@link BookingMetadata} from the flow state
 * and runs the shared {@link fulfilFreeBooking} core to create the Client, Pet
 * and Appointment and fire the best-effort notifications.
 *
 * Trust model: unlike the paid path (which verifies a succeeded PaymentIntent
 * and ran behind a Redis hold), this action TRUSTS the client-supplied slot. At
 * this stage that is acceptable for the no-deposit path — the booking carries
 * no money and the stronger guarantees live on the deposit path. We still do a
 * light sanity check that the slot start is a finite, roughly-current/future
 * timestamp, but we do NOT re-verify a hold.
 *
 * _Requirements: 7.3, 7.5, 17.2_
 */
import { fulfilFreeBooking, type FulfilSummary } from '@/lib/booking/fulfil';
import type { OwnerDetailsInput, PetInfoInput } from '@/types';

/** Input captured from the booking flow state for a no-deposit booking. */
export interface FinalizeFreeBookingInput {
  groomerSlug: string;
  pet: PetInfoInput;
  owner: OwnerDetailsInput;
  /** Selected slot start, epoch milliseconds. */
  slotStartMs: number;
  /** Selected slot end, epoch milliseconds. */
  slotEndMs: number;
  /** Optional explicit service id the client chose. */
  serviceId?: string;
  /** Whether the client ticked the SMS-consent checkbox at step 2. */
  smsConsent?: boolean;
}

/** Result envelope returned by {@link finalizeFreeBooking}. */
export type FinalizeFreeResult =
  | { ok: true; summary: FulfilSummary }
  | { ok: false; error: string };

/**
 * The widest window we accept a client-supplied slot start within: from one day
 * in the past (clock skew / same-day bookings earlier today) to roughly two
 * years out. This is a light sanity bound, NOT availability verification.
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_YEARS_MS = 2 * 365 * ONE_DAY_MS;

/**
 * Persist a no-deposit booking straight from the flow state.
 *
 * @param input the pet + owner details and the chosen slot captured in the flow.
 */
export async function finalizeFreeBooking(
  input: FinalizeFreeBookingInput
): Promise<FinalizeFreeResult> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Missing booking details.' };
  }

  const { groomerSlug, pet, owner, slotStartMs, slotEndMs } = input;

  if (typeof groomerSlug !== 'string' || groomerSlug.length === 0) {
    return { ok: false, error: 'Missing groomer reference.' };
  }
  if (!pet || !owner || !owner.address) {
    return { ok: false, error: 'Missing pet or owner details.' };
  }

  // Light sanity check on the client-supplied slot (see trust model above).
  if (!Number.isFinite(slotStartMs)) {
    return { ok: false, error: 'Invalid appointment time.' };
  }
  const now = Date.now();
  if (slotStartMs < now - ONE_DAY_MS || slotStartMs > now + TWO_YEARS_MS) {
    return { ok: false, error: 'Appointment time is out of range.' };
  }

  // Fall back to the service duration server-side when the end is absent/invalid.
  const slotEnd =
    Number.isFinite(slotEndMs) && slotEndMs > slotStartMs
      ? new Date(slotEndMs).toISOString()
      : undefined;

  const result = await fulfilFreeBooking({
    groomerSlug,
    pet,
    owner,
    slotStart: new Date(slotStartMs).toISOString(),
    slotEnd,
    serviceId: input.serviceId,
    smsConsent: input.smsConsent === true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, summary: result.summary };
}
