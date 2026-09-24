/**
 * Stripe webhook handler (POST /api/webhooks/stripe).
 *
 * Stripe delivers payment lifecycle events here. We verify the request came
 * from Stripe using the signature header and the webhook signing secret, then
 * fulfil the booking on `payment_intent.succeeded` and best-effort mark a
 * failed transaction on `payment_intent.payment_failed`.
 *
 * Fulfilment is the authoritative point at which persistent booking records
 * are created (Requirement 7.3): the Client, Pet, Appointment, and Transaction
 * are written here so a booking only materialises once money has actually
 * moved. The handler is idempotent — Stripe may deliver the same event more
 * than once, so if a Transaction already exists for a PaymentIntent we do
 * nothing further (Requirement 7.5).
 *
 * Runtime notes:
 *  - Signature verification needs the exact raw request body, so we read it
 *    with `await req.text()` and never parse it beforehand.
 *  - The Stripe Node SDK and Mongoose both require Node APIs, so this route
 *    runs on the Node.js runtime (not Edge).
 *
 * _Requirements: 7.3, 7.5_
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
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
import { createCalendarEventForAppointment } from '@/lib/calendar/google-sync';
import type {
  AddressInput,
  CoatCondition,
  OwnerDetailsInput,
  PetInfoInput,
  Temperament,
  WeightUnit,
} from '@/types';

// Stripe SDK + Mongoose require the Node.js runtime; the Edge runtime lacks the
// crypto and networking primitives they depend on.
export const runtime = 'nodejs';
// Never cache a webhook endpoint.
export const dynamic = 'force-dynamic';

/**
 * Shape of the booking payload persisted server-side as a PendingBooking when
 * the deposit intent is created (task 6.9), keyed by the PaymentIntent id.
 * Stripe metadata VALUES are capped at 500 chars, which the full pet+owner
 * payload exceeds, so the structured booking lives in the database rather than
 * on the PaymentIntent's metadata.
 */
interface BookingMetadata {
  groomerSlug: string;
  pet: PetInfoInput;
  owner: OwnerDetailsInput;
  /** ISO-8601 start of the selected slot. */
  slotStart: string;
  /** ISO-8601 end of the selected slot (optional; falls back to service duration). */
  slotEnd?: string;
  /** Optional explicit service id the client is booking. */
  serviceId?: string;
}

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
 * so the caller can skip fulfilment without throwing (a malformed record
 * should not 500).
 */
function normalizePendingBooking(record: unknown): BookingMetadata | null {
  if (typeof record !== 'object' || record === null) return null;
  const b = record as Partial<BookingMetadata>;

  if (typeof b.groomerSlug !== 'string' || b.groomerSlug.length === 0) return null;
  if (typeof b.slotStart !== 'string' || b.slotStart.length === 0) return null;
  if (!b.pet || !b.owner || !b.owner.address) return null;

  const pet = b.pet as Partial<PetInfoInput>;
  const owner = b.owner as Partial<OwnerDetailsInput>;
  const address = owner.address as Partial<AddressInput>;

  // Minimal validation of the fields we actually persist.
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
function formatServiceAddress(address: AddressInput): string {
  return `${address.street}, ${address.city}, ${address.state} ${address.postalCode}`.trim();
}

/**
 * Fulfil a successful deposit: create/update Client + Pet, create the
 * Appointment, and record the Transaction. Idempotent on `stripePaymentId`.
 */
async function fulfilBooking(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const stripePaymentId = paymentIntent.id;

  await connectDB();

  // Idempotency guard: if we already recorded this payment, do nothing more.
  const existing = await Transaction.findOne({ stripePaymentId }).lean();
  if (existing) return;

  // The full booking (pet + owner + slot) was persisted server-side when the
  // PaymentIntent was created, keyed by its id — Stripe metadata is too small
  // to carry it. Look it up here rather than parsing the intent metadata.
  const pending = await PendingBooking.findOne({ paymentIntentId: stripePaymentId }).lean();
  const booking = normalizePendingBooking(pending);
  if (!booking) {
    console.error(
      `Stripe webhook: payment_intent.succeeded ${stripePaymentId} had no valid pending booking; skipping fulfilment.`
    );
    return;
  }

  // Resolve the groomer from the public slug.
  const profile = await GroomerProfile.findOne({ groomerSlug: booking.groomerSlug })
    .select('userId businessName')
    .lean();
  if (!profile) {
    console.error(
      `Stripe webhook: no groomer profile for slug "${booking.groomerSlug}" (payment ${stripePaymentId}).`
    );
    return;
  }
  const groomerId = profile.userId;
  const businessName =
    (typeof profile.businessName === 'string' && profile.businessName.trim()) ||
    'your groomer';

  // Resolve the service (explicit id when provided, else the groomer's first
  // active service) so we can derive the appointment end time from its duration.
  const email = booking.owner.email.toLowerCase();
  const service = booking.serviceId
    ? await Service.findOne({ _id: booking.serviceId, groomerId }).lean()
    : await Service.findOne({ groomerId, isActive: true }).sort({ createdAt: 1 }).lean();

  if (!service) {
    console.error(
      `Stripe webhook: no bookable service for groomer ${String(groomerId)} (payment ${stripePaymentId}).`
    );
    return;
  }

  const scheduledDate = new Date(booking.slotStart);
  const scheduledEndDate = booking.slotEnd
    ? new Date(booking.slotEnd)
    : new Date(scheduledDate.getTime() + service.durationMinutes * 60 * 1000);

  // Upsert the Client (unique per groomer + email).
  const client = await Client.findOneAndUpdate(
    { groomerId, email },
    {
      $set: {
        name: booking.owner.name,
        phone: booking.owner.phone,
        address: booking.owner.address,
      },
      $setOnInsert: { groomerId, email },
    },
    { new: true, upsert: true }
  );

  // Upsert the Pet (belonging to that client + groomer). We match on name to
  // avoid creating duplicate pets for repeat bookings of the same animal.
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
      $setOnInsert: {
        groomerId,
        clientId: client._id,
        name: booking.pet.name,
      },
    },
    { new: true, upsert: true }
  );

  // Create the Appointment.
  const appointment = await Appointment.create({
    groomerId,
    clientId: client._id,
    petId: pet._id,
    serviceId: service._id,
    scheduledDate,
    scheduledEndDate,
    status: 'upcoming',
    serviceAddress: formatServiceAddress(booking.owner.address),
    notes: booking.pet.notes,
  });

  // Record the Transaction. The unique index on `stripePaymentId` is the final
  // backstop for idempotency if two deliveries race past the lean() check.
  try {
    await Transaction.create({
      appointmentId: appointment._id,
      groomerId,
      stripePaymentId,
      amount: (paymentIntent.amount_received ?? paymentIntent.amount) / 100,
      currency: paymentIntent.currency ?? 'usd',
      status: 'succeeded',
    });
  } catch (err) {
    // Duplicate key => another delivery already recorded it; roll back the
    // appointment we just created to avoid an orphaned booking.
    if (isDuplicateKeyError(err)) {
      await Appointment.deleteOne({ _id: appointment._id });
      return;
    }
    throw err;
  }

  // The booking is now fully materialised. Clean up the server-side pending
  // record (the TTL index would eventually reap it anyway).
  await PendingBooking.deleteOne({ paymentIntentId: stripePaymentId });

  // Best-effort: mirror this booking onto the shared Google Calendar and
  // persist the returned event id so later status changes can patch it. This
  // helper never throws and returns null on failure/unconfigured, so a
  // calendar problem cannot fail the completed booking (Req 8.4 / 8.6).
  try {
    const googleEventId = await createCalendarEventForAppointment({
      serviceName: service.name,
      petName: booking.pet.name,
      clientName: booking.owner.name,
      clientPhone: booking.owner.phone,
      startISO: scheduledDate.toISOString(),
      endISO: scheduledEndDate.toISOString(),
      location: formatServiceAddress(booking.owner.address),
      notes: booking.pet.notes,
    });
    if (googleEventId) {
      await Appointment.updateOne(
        { _id: appointment._id },
        { $set: { googleEventId } }
      );
    }
  } catch (calendarErr) {
    // Defensive: createCalendarEventForAppointment is best-effort and should
    // not throw, but guard anyway so nothing downstream of fulfilment breaks.
    console.error(
      `Stripe webhook: calendar event creation failed for payment ${stripePaymentId}:`,
      calendarErr
    );
  }

  // Best-effort notifications AFTER records are created (Req 8.2 / 8.3). These
  // helpers never throw and return a boolean, so a delivery failure never
  // affects the completed booking.
  await sendBookingNotifications(paymentIntent, booking, {
    groomerBusinessName: businessName,
    serviceName: service.name,
    scheduledDate,
  });
}

/**
 * Fire the client-confirmation and groomer-notification emails for a freshly
 * created booking. Best-effort: both helpers swallow their own errors and
 * return a boolean, and we additionally guard the whole block so a notification
 * problem can never fail webhook fulfilment (Req 8.2, 8.3, 8.6).
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
    const depositAmount =
      (paymentIntent.amount_received ?? paymentIntent.amount) / 100;
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
    // Notifications are strictly best-effort — never let them break fulfilment.
    console.error(
      `Stripe webhook: notification dispatch failed for payment ${paymentIntent.id}:`,
      err
    );
  }
}

/**
 * Best-effort handling of a failed payment: if we recorded a pending/succeeded
 * Transaction for this PaymentIntent, mark it failed. If none exists we do
 * nothing (a booking is only ever persisted on success).
 */
async function markPaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  await connectDB();
  await Transaction.updateOne(
    { stripePaymentId: paymentIntent.id },
    { $set: { status: 'failed' } }
  );
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

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Stripe webhook: STRIPE_WEBHOOK_SECRET is not configured.');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // Read the RAW body for signature verification (do not JSON-parse first).
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    console.error('Stripe webhook signature verification failed:', message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await fulfilBooking(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await markPaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (err) {
    // Returning 500 asks Stripe to retry delivery later. The handler is
    // idempotent, so a retry is safe.
    console.error(`Stripe webhook: error handling ${event.type}:`, err);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  // Acknowledge quickly so Stripe considers the event delivered.
  return NextResponse.json({ received: true }, { status: 200 });
}
