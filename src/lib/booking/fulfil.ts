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
import type { Types } from 'mongoose';
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
 * Upsert the booking's Client (keyed by `{groomerId, email}`) and Pet (keyed by
 * `{groomerId, clientId, name}`) using the SAME field mapping for every caller.
 *
 * Shared by both the paid path ({@link fulfilBookingByPaymentIntentId}) and the
 * no-deposit path ({@link fulfilFreeBooking}) so the two can never drift. The
 * SMS-consent timestamp is stamped on the Client only when the client ticked
 * the consent box at step 2.
 */
async function upsertClientAndPet(
  groomerId: Types.ObjectId,
  booking: BookingMetadata
): Promise<{ client: { _id: Types.ObjectId }; pet: { _id: Types.ObjectId } }> {
  const email = booking.owner.email.toLowerCase();

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

  return { client, pet };
}

/**
 * Best-effort hold release + slot-cache invalidation for a freshly created
 * booking. Shared by both paths; never throws past this block so a Redis
 * hiccup can't fail fulfilment. `logId` only tags the console output.
 */
async function releaseHoldAndBustCache(
  groomerId: Types.ObjectId,
  holdId: string | undefined,
  scheduledDate: Date,
  logId: string
): Promise<void> {
  if (!holdId) return;
  const holdDateStr = scheduledDate.toISOString().slice(0, 10);
  try {
    await releaseHold(String(groomerId), holdId, holdDateStr);
  } catch (holdErr) {
    console.error(`fulfil: releaseHold failed for ${logId}:`, holdErr);
  }
  try {
    await invalidateSlotsCache(String(groomerId), holdDateStr);
  } catch (cacheErr) {
    console.error(`fulfil: invalidateSlotsCache failed for ${logId}:`, cacheErr);
  }
}

/**
 * Best-effort SMS confirmation + reminder scheduling for a freshly created
 * booking. Shared by both paths; guarded so an SMS/QStash problem can never
 * fail fulfilment (Master Spec §12.3). `logId` only tags the console output.
 */
async function sendBookingSms(
  args: {
    groomerId: Types.ObjectId;
    clientId: Types.ObjectId;
    appointmentId: Types.ObjectId;
    phone: string;
    petName: string;
    scheduledDate: Date;
  },
  logId: string
): Promise<void> {
  try {
    const dateStr = args.scheduledDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const timeStr = args.scheduledDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const { sendSms } = await import('@/lib/sms/send-sms');
    await sendSms({
      groomerId: String(args.groomerId),
      clientId: String(args.clientId),
      appointmentId: String(args.appointmentId),
      to: args.phone,
      kind: 'booking_confirmed',
      vars: { pet: args.petName, date: dateStr, time: timeStr },
    });

    const { scheduleReminders } = await import('@/lib/sms/reminders');
    await scheduleReminders({
      groomerId: String(args.groomerId),
      appointmentId: String(args.appointmentId),
      startAtMs: args.scheduledDate.getTime(),
    });
  } catch (smsErr) {
    console.error(`fulfil: SMS dispatch/scheduling failed for ${logId}:`, smsErr);
  }
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

  const { client, pet } = await upsertClientAndPet(groomerId, booking);

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
  await releaseHoldAndBustCache(
    groomerId,
    booking.holdId,
    scheduledDate,
    stripePaymentId
  );

  // Best-effort notifications AFTER records are created (Req 8.2 / 8.3).
  await sendBookingNotifications(booking, {
    groomerBusinessName: businessName,
    serviceName: service.name,
    scheduledDate,
    depositAmount: depositAmountOf(paymentIntent),
    currency: paymentIntent.currency ?? 'usd',
  });

  // Best-effort SMS confirmation + reminder scheduling (Master Spec §12.3).
  await sendBookingSms(
    {
      groomerId,
      clientId: client._id,
      appointmentId: appointment._id,
      phone: booking.owner.phone,
      petName: booking.pet.name,
      scheduledDate,
    },
    stripePaymentId
  );

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
 * Materialise a NO-DEPOSIT booking directly from the flow state — the Stripe-
 * free counterpart to {@link fulfilBookingByPaymentIntentId}.
 *
 * A groomer with a $0 deposit never creates a PaymentIntent nor a
 * PendingBooking, so there is no payment-driven path to persist the booking.
 * This function does the same Client + Pet upsert, Appointment creation, hold
 * release and best-effort notifications as the paid path — reusing the SAME
 * shared helpers so the two can never drift — but records NO Transaction row
 * (there is no payment) and reports a zero deposit.
 *
 * Idempotency: a free booking has no Stripe id to dedupe on, so this creates
 * the appointment unconditionally. A double-submit is unlikely because the
 * success step owns a single on-mount call behind its own loading state. We
 * deliberately keep this simple rather than inventing a synthetic key.
 *
 * @returns a {@link FulfilResult} with `depositAmount: 0`, `currency: 'usd'`
 *   and an empty `paymentIntentId`.
 */
export async function fulfilFreeBooking(
  booking: BookingMetadata
): Promise<FulfilResult> {
  await connectDB();

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

  const bookingRef = booking.bookingRef || generateBookingRef();

  const { client, pet } = await upsertClientAndPet(groomerId, booking);

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
    source: 'public',
  });

  // Best-effort hold release + cache bust (never throws past this block).
  await releaseHoldAndBustCache(groomerId, booking.holdId, scheduledDate, bookingRef);

  // Best-effort notifications AFTER records are created, with a zero deposit
  // (Req 8.2 / 8.3). Guarded so a notification problem can't fail fulfilment.
  await sendBookingNotifications(booking, {
    groomerBusinessName: businessName,
    serviceName: service.name,
    scheduledDate,
    depositAmount: 0,
    currency: 'usd',
  });

  // Best-effort SMS confirmation + reminder scheduling (Master Spec §12.3).
  await sendBookingSms(
    {
      groomerId,
      clientId: client._id,
      appointmentId: appointment._id,
      phone: booking.owner.phone,
      petName: booking.pet.name,
      scheduledDate,
    },
    bookingRef
  );

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
      depositAmount: 0,
      currency: 'usd',
      paymentIntentId: '',
      businessName,
    },
  };
}

/**
 * Fire the client-confirmation and groomer-notification emails for a freshly
 * created booking. Best-effort: guarded so a notification problem can never
 * fail fulfilment (Req 8.2, 8.3, 8.6).
 *
 * The deposit amount + currency are passed in explicitly rather than derived
 * from a PaymentIntent, so both the paid path and the no-deposit path
 * ({@link fulfilFreeBooking}, which passes `depositAmount: 0`) can share it.
 */
async function sendBookingNotifications(
  booking: BookingMetadata,
  ctx: {
    groomerBusinessName: string;
    serviceName: string;
    scheduledDate: Date;
    depositAmount: number;
    currency: string;
  }
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
    const currency = (ctx.currency || 'usd').toUpperCase();

    await sendClientConfirmationEmail(booking.owner.email, {
      date: dateStr,
      time: timeStr,
      services: [ctx.serviceName],
      serviceAddress,
      groomerName: ctx.groomerBusinessName,
      depositAmount: ctx.depositAmount,
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
    console.error('fulfil: notification dispatch failed:', err);
  }
}
