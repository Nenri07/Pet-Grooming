/**
 * Stripe CONNECT webhook (POST /api/stripe/connect-webhook) — Master Spec §13.3.
 *
 * Handles events for client-deposit payments routed to groomers via Stripe
 * Connect. This is separate from the platform deposit webhook
 * (/api/webhooks/stripe) and from the subscription billing webhook: Connect
 * events are signed with their OWN endpoint secret so they can be managed
 * independently.
 *
 * Signing secret: `STRIPE_CONNECT_WEBHOOK_SECRET`, falling back to
 * `STRIPE_WEBHOOK_SECRET` for local/dev. When NO secret is configured, the
 * endpoint no-ops with 200 so an unconfigured deployment does not error.
 *
 * Handled events (§13.3):
 *   - payment_intent.succeeded / payment_intent.payment_failed → mark the
 *     Transaction (best-effort; keeps deposit records in sync).
 *   - charge.refunded → mark the Transaction refunded.
 *   - account.updated → track whether the groomer's Connect account can accept
 *     charges (onboarding complete), stored on GroomerProfile.
 *
 * Idempotent via the Redis `idem:stripe:{eventId}` guard, Node runtime,
 * signature-verified.
 *
 * _Master Spec: §13.3, §15_
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { connectDB } from '@/lib/db/connect';
import { Transaction } from '@/lib/db/models/transaction';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { idempotencyOnce, isRedisConfigured } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The Connect webhook secret, preferring the dedicated one. */
function connectWebhookSecret(): string | undefined {
  return process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
}

/** Mark a Transaction's status by its Stripe PaymentIntent id (best-effort). */
async function markTransaction(
  paymentIntentId: string,
  status: 'succeeded' | 'failed' | 'refunded'
): Promise<void> {
  await Transaction.updateOne({ stripePaymentId: paymentIntentId }, { $set: { status } });
}

/** Track whether a groomer's Connect account can accept charges (§13.3). */
async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  const groomerId = (account.metadata?.groomerId as string) ?? null;
  const filter = groomerId
    ? { userId: groomerId }
    : { stripeConnectAccountId: account.id };
  await GroomerProfile.updateOne(filter, {
    $set: {
      stripeConnectAccountId: account.id,
      stripeConnectChargesEnabled: Boolean(account.charges_enabled),
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const secret = connectWebhookSecret();
  if (!secret) {
    return NextResponse.json({ received: true, configured: false }, { status: 200 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    console.error('[connect-webhook] signature verification failed:', message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  if (isRedisConfigured()) {
    try {
      const first = await idempotencyOnce(event.id);
      if (!first) {
        return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
      }
    } catch (idemErr) {
      console.error('[connect-webhook] idempotency check failed; proceeding:', idemErr);
    }
  }

  try {
    await connectDB();
    switch (event.type) {
      case 'payment_intent.succeeded':
        await markTransaction((event.data.object as Stripe.PaymentIntent).id, 'succeeded');
        break;
      case 'payment_intent.payment_failed':
        await markTransaction((event.data.object as Stripe.PaymentIntent).id, 'failed');
        break;
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const pi =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        if (pi) await markTransaction(pi, 'refunded');
        break;
      }
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`[connect-webhook] error handling ${event.type}:`, err);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
