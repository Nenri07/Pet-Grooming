/**
 * Shared booking fulfilment core.
 *
 * This is the ONE idempotent implementation that materialises a booking from a
 * succeeded Stripe PaymentIntent: it creates/updates the Client + Pet, creates
 * the Appointment (stamped with a human-friendly bookingRef), records the
 * Transaction, releases any Redis hold, and fires best-effort email + SMS.
 *
 * Two callers share this exact logic:
 *   1. The Stripe webhook (`payment_intent.succeeded`) — the authoritative
 *      backstop that runs even if the client never reaches the success screen.
 *   2. The client-triggered `finalizeBookingByPaymentIntent` server action —
 *      the webhook-INDEPENDENT fallback so a booking still saves when the
 *      webhook is delayed or not configured on the host.
 *
 * Idempotency / race-safety: fulfilment is guarded by the Transaction's unique
 * index on `stripePaymentId`. A fast `findOne` short-circuits the common case;
 * the unique index is the final backstop when two callers race past that check
 * — the loser catches the duplicate-key error and rolls back the appointment
 * it created, so the booking is never double-created. Both callers are safe to
 * run concurrently.
 *
 * _Requirements: 7.3, 7.5_
 */
import type Stripe from 'stripe';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { Service } from '@/lib/db/models/service';
import { Client } from '@/lib/db/models/client';
import { Pet } from '@/lib/db/models/pet';
import { Appointment } from '@/lib/db/models/appointment';
import { Transaction } from '@/lib/db/models/transaction';
import { PendingBooking } from '@/lib/db/models/pending-booking';
import {
  sendClientConfirmationEmail,
  sendGroomerNotificationEmail,
} from '@/lib/email/send';
import { releaseHold } from '@/lib/calendar/holds';
import { invalidateSlotsCache } from '@/lib/calendar/slots';
import { generateBookingRef } from '@/lib/booking/reference';
import type {
  AddressInput,
  CoatCondition,
  OwnerDetailsInput,
  PetInfoInput,
  Temperament,
  WeightUnit,
} from '@/types';

/**
 * Shape of the booking payload persisted server-side as a PendingBooking when
 * the deposit intent is created, keyed by the PaymentIntent id. Stripe metadata
 * VALUES are capped at 500 chars, which the full pet+owner payload exceeds, so
 * the structured booking lives in the database rather than on the intent.
 */
export interface BookingMetadata {
  groomerSlug: string;
  pet: PetInfoInput;
  owner: OwnerDetailsInput;
  /** ISO-8601 start of the selected slot. */
  slotStart: string;
  /** ISO-8601 end of the selected slot (optional; falls back to service duration). */
  slotEnd?: string;
  /** Optional explicit service id the client is booking. */
  serviceId?: string;
  /** Optional Redis hold id placed on the slot before payment. */
  holdId?: string;
  /** Whether the client ticked the SMS-consent checkbox at booking step 2. */
  smsConsent?: boolean;
  /** The human-friendly booking reference minted at checkout (reused here). */
  bookingRef?: string;
}

/**
 * A compact, serializable summary of a fulfilled booking, returned so a client
 * caller can render the confirmation ticket / receipt without re-querying.
 */
export interface FulfilSummary {
  bookingRef: string;
  petName: string;
  serviceName: string;
  serviceAddress: string;
  clientName: string;
  /** ISO-8601 start of the appointment. */
  scheduledDate: string;
  /** ISO-8601 end of the appointment. */
  scheduledEndDate: string;
  /** Deposit amount in whole currency units. */
  depositAmount: number;
  /** ISO 4217 currency code (lowercase). */
  currency: string;
  /** The Stripe PaymentIntent / transaction id. */
  paymentIntentId: string;
  businessName: string;
}

/** The result of a fulfilment attempt. */
export type FulfilResult =
  | { ok: true; created: boolean; summary: FulfilSummary }
  | { ok: false; error: string };

const COAT_CONDITIONS: readonly CoatCondition[] = [
  'smooth',
  'double',
  'wire',
  'curly',
  'long',
  'matted',
];
const TEMPERAMENTS: readonly Temperament[] = [
  'calm',
  'nervous',
  'aggressive',
  'friendly',
];
const WEIGHT_UNITS: readonly WeightUnit[] = ['lbs', 'kg'];

/**
 * Validate and normalise a persisted PendingBooking record into the shape we
 * persist. Returns `null` when the record is absent or structurally invalid,
 * so the caller can skip fulfilment without throwing.
 */
export function normalizePendingBooking(record: unknown): BookingMetadata | null {
  if (typeof record !== 'object' || record === null) return null;
  const b = record as Partial<BookingMetadata>;

  if (typeof b.groomerSlug !== 'string' || b.groomerSlug.length === 0) return null;
  if (typeof b.slotStart !== 'string' || b.slotStart.length === 0) return null;
  if (!b.pet || !b.owner || !b.owner.address) return null;

  const pet = b.pet as Partial<PetInfoInput>;
  const owner = b.owner as Partial<OwnerDetailsInput>;
  const address = owner.address as Partial<AddressInput>;

  if (
    typeof pet.name !== 'string' ||
    typeof pet.breed !== 'string' ||
    typeof pet.weight !== 'number' ||
    typeof pet.age !== 'number' ||
    !pet.temperament ||
    !TEMPERAMENTS.includes(pet.temperament) ||
    !pet.coatCondition ||
    !COAT_CONDITIONS.includes(pet.coatCondition)
  ) {
    return null;
  }

  if (
    typeof owner.name !== 'string' ||
    typeof owner.email !== 'string' ||
    typeof owner.phone !== 'string' ||
    typeof address.street !== 'string' ||
    typeof address.city !== 'string' ||
    typeof address.state !== 'string' ||
    typeof address.postalCode !== 'string'
  ) {
    return null;
  }

  const weightUnit: WeightUnit =
    pet.weightUnit && WEIGHT_UNITS.includes(pet.weightUnit) ? pet.weightUnit : 'lbs';

  return {
    groomerSlug: b.groomerSlug,
    slotStart: b.slotStart,
    slotEnd: typeof b.slotEnd === 'string' ? b.slotEnd : undefined,
    serviceId: typeof b.serviceId === 'string' ? b.serviceId : undefined,
    holdId: typeof b.holdId === 'string' ? b.holdId : undefined,
    smsConsent: b.smsConsent === true,
    bookingRef: typeof b.bookingRef === 'string' ? b.bookingRef : undefined,
    pet: {
      name: pet.name,
      photoUrl: typeof pet.photoUrl === 'string' ? pet.photoUrl : undefined,
      breed: pet.breed,
      weight: pet.weight,
      weightUnit,
      age: pet.age,
      temperament: pet.temperament,
      coatCondition: pet.coatCondition,
      specialFlags: Array.isArray(pet.specialFlags)
        ? pet.specialFlags.filter((f): f is string => typeof f === 'string')
        : [],
      notes: typeof pet.notes === 'string' ? pet.notes : undefined,
    },
    owner: {
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      address: {
        street: address.street,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
      },
    },
  };
}

/** Format a Client's address into the single-line appointment serviceAddress. */
export function formatServiceAddress(address: AddressInput): string {
  return `${address.street}, ${address.city}, ${address.state} ${address.postalCode}`.trim();
}

/** Narrow an unknown error to a MongoDB duplicate-key error (code 11000). */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 11000
  );
}

/**
 * Deposit amount (whole currency units) received on a PaymentIntent.
 */
function depositAmountOf(paymentIntent: Stripe.PaymentIntent): number {
  return (paymentIntent.amount_received ?? paymentIntent.amount) / 100;
}

/**
 * Look up an already-fulfilled booking by its PaymentIntent id and build the
 * summary from the persisted records. Returns `null` when no Transaction
 * exists yet (i.e. the booking has not been fulfilled). Used by the fast
 * idempotency path so a repeat call returns the SAME bookingRef.
 */
async function summariseExisting(
  paymentIntentId: string,
  paymentIntent?: Stripe.PaymentIntent
): Promise<FulfilSummary | null> {
  const txn = (await Transaction.findOne({
    stripePaymentId: paymentIntentId,
  }).lean()) as {
    appointmentId: unknown;
    amount: number;
    currency?: string;
  } | null;
  if (!txn) return null;

  const appointment = (await Appointment.findById(txn.appointmentId).lean()) as {
    petId: unknown;
    clientId: unknown;
    serviceId: unknown;
    groomerId: unknown;
    bookingRef?: string;
    serviceAddress?: string;
    scheduledDate: Date | string;
    scheduledEndDate: Date | string;
  } | null;
  if (!appointment) {
    // A transaction with no appointment shouldn't happen, but degrade rather
    // than throw — surface what we can from the transaction alone.
    return {
      bookingRef: '',
      petName: '',
      serviceName: '',
      serviceAddress: '',
      clientName: '',
      scheduledDate: '',
      scheduledEndDate: '',
      depositAmount: txn.amount,
      currency: txn.currency ?? 'usd',
      paymentIntentId,
      businessName: '',
    };
  }

  const [pet, client, service, profile] = await Promise.all([
    Pet.findById(appointment.petId).select('name').lean(),
    Client.findById(appointment.clientId).select('name').lean(),
    Service.findById(appointment.serviceId).select('name').lean(),
    GroomerProfile.findOne({ userId: appointment.groomerId })
      .select('businessName')
      .lean(),
  ]);

  return {
    bookingRef: appointment.bookingRef ?? '',
    petName: (pet as { name?: string } | null)?.name ?? '',
    serviceName: (service as { name?: string } | null)?.name ?? '',
    serviceAddress: appointment.serviceAddress ?? '',
    clientName: (client as { name?: string } | null)?.name ?? '',
    scheduledDate: new Date(appointment.scheduledDate).toISOString(),
    scheduledEndDate: new Date(appointment.scheduledEndDate).toISOString(),
    depositAmount: paymentIntent ? depositAmountOf(paymentIntent) : txn.amount,
    currency: txn.currency ?? 'usd',
    paymentIntentId,
    businessName:
      (profile as { businessName?: string } | null)?.businessName ?? '',
  };
}

/**
 * Fulfil a successful deposit from its PaymentIntent, idempotently. Shared by
 * the webhook and the client fallback action.
 *
 * @returns a {@link FulfilResult}: on success it reports whether it `created`
 *   the booking (vs. found an already-fulfilled one) and the display summary
 *   including the shared bookingRef.
 */
export async function fulfilBookingByPaymentIntentId(
  paymentIntent: Stripe.PaymentIntent
): Promise<FulfilResult> {
  const stripePaymentId = paymentIntent.id;

  await connectDB();

  // Fast idempotency path: if we already recorded this payment, return the
  // existing booking's summary (same bookingRef) instead of re-creating.
  const existingSummary = await summariseExisting(stripePaymentId, paymentIntent);
  if (existingSummary) {
    return { ok: true, created: false, summary: existingSummary };
  }

  const pending = await PendingBooking.findOne({
    paymentIntentId: stripePaymentId,
  }).lean();
  const booking = normalizePendingBooking(pending);
  if (!booking) {
    return {
      ok: false,
      error: 'No valid pending booking found for this payment.',
    };
  }

  const profile = await GroomerProfile.findOne({ groomerSlug: booking.groomerSlug })
    .select('userId businessName')
    .lean();
  if (!profile) {
    return {
      ok: false,
      error: `No groomer profile for slug "${booking.groomerSlug}".`,
    };
  }
  const groomerId = profile.userId;
  const businessName =
    (typeof profile.businessName === 'string' && profile.businessName.trim()) ||
    'your groomer';

  const email = booking.owner.email.toLowerCase();
  const service = booking.serviceId
    ? await Service.findOne({ _id: booking.serviceId, groomerId }).lean()
    : await Service.findOne({ groomerId, isActive: true }).sort({ createdAt: 1 }).lean();

  if (!service) {
    return {
      ok: false,
      error: 'No bookable service for this groomer.',
    };
  }

  const scheduledDate = new Date(booking.slotStart);
  const scheduledEndDate = booking.slotEnd
    ? new Date(booking.slotEnd)
    : new Date(scheduledDate.getTime() + service.durationMinutes * 60 * 1000);

  // Reuse the reference minted at checkout, or generate one now if absent
  // (older PendingBooking records / no-Stripe flows).
  const bookingRef = booking.bookingRef || generateBookingRef();

  const clientSet: Record<string, unknown> = {
    name: booking.owner.name,
    phone: booking.owner.phone,
    address: booking.owner.address,
  };
  if (booking.smsConsent) {
    clientSet.smsConsentAt = new Date();
  }
  const client = await Client.findOneAndUpdate(
    { groomerId, email },
    { $set: clientSet, $setOnInsert: { groomerId, email } },
    { new: true, upsert: true }
  );

  const pet = await Pet.findOneAndUpdate(
    { groomerId, clientId: client._id, name: booking.pet.name },
    {
      $set: {
        photoUrl: booking.pet.photoUrl,
        breed: booking.pet.breed,
        weight: booking.pet.weight,
        weightUnit: booking.pet.weightUnit,
        age: booking.pet.age,
        temperament: booking.pet.temperament,
        coatCondition: booking.pet.coatCondition,
        specialFlags: booking.pet.specialFlags ?? [],
        notes: booking.pet.notes,
      },
      $setOnInsert: { groomerId, clientId: client._id, name: booking.pet.name },
    },
    { new: true, upsert: true }
  );

  const serviceAddress = formatServiceAddress(booking.owner.address);

  const appointment = await Appointment.create({
    groomerId,
    clientId: client._id,
    petId: pet._id,
    serviceId: service._id,
    scheduledDate,
    scheduledEndDate,
    status: 'upcoming',
    serviceAddress,
    notes: booking.pet.notes,
    bookingRef,
  });

  // Record the Transaction. The unique index on `stripePaymentId` is the final
  // backstop for idempotency if two callers race past the summariseExisting
  // check. The loser rolls back the appointment it just created.
  try {
    await Transaction.create({
      appointmentId: appointment._id,
      groomerId,
      stripePaymentId,
      amount: depositAmountOf(paymentIntent),
      currency: paymentIntent.currency ?? 'usd',
      status: 'succeeded',
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Another caller already fulfilled this payment — roll back our orphan
      // appointment and return THEIR persisted summary (same bookingRef).
      await Appointment.deleteOne({ _id: appointment._id });
      const raced = await summariseExisting(stripePaymentId, paymentIntent);
      if (raced) return { ok: true, created: false, summary: raced };
      return { ok: false, error: 'Booking was already being finalized.' };
    }
    throw err;
  }

  // Clean up the server-side pending record (TTL would reap it anyway).
  await PendingBooking.deleteOne({ paymentIntentId: stripePaymentId });

  // Best-effort hold release + cache bust (never throws past this block).
  if (booking.holdId) {
    const holdDateStr = scheduledDate.toISOString().slice(0, 10);
    try {
      await releaseHold(String(groomerId), booking.holdId, holdDateStr);
    } catch (holdErr) {
      console.error(`fulfil: releaseHold failed for ${stripePaymentId}:`, holdErr);
    }
    try {
      await invalidateSlotsCache(String(groomerId), holdDateStr);
    } catch (cacheErr) {
      console.error(
        `fulfil: invalidateSlotsCache failed for ${stripePaymentId}:`,
        cacheErr
      );
    }
  }

  // Best-effort notifications AFTER records are created (Req 8.2 / 8.3).
  await sendBookingNotifications(paymentIntent, booking, {
    groomerBusinessName: businessName,
    serviceName: service.name,
    scheduledDate,
  });

  // Best-effort SMS confirmation + reminder scheduling (Master Spec §12.3).
  try {
    const dateStr = scheduledDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const timeStr = scheduledDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const { sendSms } = await import('@/lib/sms/send-sms');
    await sendSms({
      groomerId: String(groomerId),
      clientId: String(client._id),
      appointmentId: String(appointment._id),
      to: booking.owner.phone,
      kind: 'booking_confirmed',
      vars: { pet: booking.pet.name, date: dateStr, time: timeStr },
    });

    const { scheduleReminders } = await import('@/lib/sms/reminders');
    await scheduleReminders({
      groomerId: String(groomerId),
      appointmentId: String(appointment._id),
      startAtMs: scheduledDate.getTime(),
    });
  } catch (smsErr) {
    console.error(`fulfil: SMS dispatch/scheduling failed for ${stripePaymentId}:`, smsErr);
  }

  return {
    ok: true,
    created: true,
    summary: {
      bookingRef,
      petName: booking.pet.name,
      serviceName: service.name,
      serviceAddress,
      clientName: booking.owner.name,
      scheduledDate: scheduledDate.toISOString(),
      scheduledEndDate: scheduledEndDate.toISOString(),
      depositAmount: depositAmountOf(paymentIntent),
      currency: paymentIntent.currency ?? 'usd',
      paymentIntentId: stripePaymentId,
      businessName,
    },
  };
}

/**
 * Fire the client-confirmation and groomer-notification emails for a freshly
 * created booking. Best-effort: guarded so a notification problem can never
 * fail fulfilment (Req 8.2, 8.3, 8.6).
 */
async function sendBookingNotifications(
  paymentIntent: Stripe.PaymentIntent,
  booking: BookingMetadata,
  ctx: { groomerBusinessName: string; serviceName: string; scheduledDate: Date }
): Promise<void> {
  try {
    const dateStr = ctx.scheduledDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = ctx.scheduledDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const serviceAddress = formatServiceAddress(booking.owner.address);
    const depositAmount = depositAmountOf(paymentIntent);
    const currency = (paymentIntent.currency ?? 'usd').toUpperCase();

    await sendClientConfirmationEmail(booking.owner.email, {
      date: dateStr,
      time: timeStr,
      services: [ctx.serviceName],
      serviceAddress,
      groomerName: ctx.groomerBusinessName,
      depositAmount,
      currency,
    });

    await sendGroomerNotificationEmail({
      date: dateStr,
      time: timeStr,
      services: [ctx.serviceName],
      serviceAddress,
      clientName: booking.owner.name,
      clientPhone: booking.owner.phone,
      petName: booking.pet.name,
      petBreed: booking.pet.breed,
      petSize: `${booking.pet.weight} ${booking.pet.weightUnit}`,
      specialNotes: booking.pet.notes,
    });
  } catch (err) {
    console.error(
      `fulfil: notification dispatch failed for ${paymentIntent.id}:`,
      err
    );
  }
}
