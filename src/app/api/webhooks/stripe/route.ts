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
import { Transaction } from '@/lib/db/models/transaction';
import { idempotencyOnce, isRedisConfigured } from '@/lib/redis';
import { fulfilBookingByPaymentIntentId } from '@/lib/booking/fulfil';

// Stripe SDK + Mongoose require the Node.js runtime; the Edge runtime lacks the
// crypto and networking primitives they depend on.
export const runtime = 'nodejs';
// Never cache a webhook endpoint.
export const dynamic = 'force-dynamic';

/**
 * Fulfil a successful deposit. Delegates to the shared, idempotent fulfilment
 * core in `@/lib/booking/fulfil` — the SAME implementation the client-triggered
 * `finalizeBookingByPaymentIntent` action calls, so there is exactly one
 * commit path guarded by the Transaction unique index. A benign "no pending
 * booking" result is logged (the client fallback may have already fulfilled it,
 * or the record expired) rather than treated as a webhook failure.
 */
async function fulfilBooking(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const result = await fulfilBookingByPaymentIntentId(paymentIntent);
  if (!result.ok) {
    console.error(
      `Stripe webhook: fulfilment of ${paymentIntent.id} did not complete: ${result.error}`
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

  // Fast idempotency guard (Master Spec §9.4): claim this event id in Redis
  // exactly once. This is ADDITIVE to the authoritative Transaction-based guard
  // in fulfilBooking — it cheaply short-circuits Stripe's duplicate deliveries
  // before any DB work. Guarded by isRedisConfigured() so local/no-Redis setups
  // still work purely on the Transaction unique-index guard. Fail open: if the
  // claim itself errors, fall through to normal (idempotent) processing.
  if (isRedisConfigured()) {
    try {
      const first = await idempotencyOnce(event.id);
      if (!first) {
        return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
      }
    } catch (idemErr) {
      console.error(
        `Stripe webhook: idempotency check failed for event ${event.id}; proceeding:`,
        idemErr
      );
    }
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
