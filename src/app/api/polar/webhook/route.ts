/**
 * Polar webhook (/api/polar/webhook) - subscriptions + SMS top-ups.
 *
 * Verifies the signed payload with the SDK's webhooks.validateEvent (we do
 * NOT use @polar-sh/nextjs - it needs Next 15/16; this app is Next 14), then
 * drives the SAME Subscription state machine the Stripe billing webhook does:
 * subscription active/updated/cycled -> status 'active' (+ plan/smsIncluded
 * from the product, + currentPeriodEnd); subscription.revoked -> read-only;
 * order.paid (SMS top-up product) -> credit smsTopupBalance. Idempotent, acks
 * 200 on unknown/unresolvable events, invalidates the entitlements cache after
 * each write. Does NOT touch the Stripe deposit/Connect webhooks.
 */
import { NextResponse } from 'next/server';
import { webhooks } from '@polar-sh/sdk/2026-10';
import { connectDB } from '@/lib/db/connect';
import { Subscription } from '@/lib/db/models/subscription';
import { invalidateEntitlements } from '@/lib/billing/entitlements';
import { PLANS } from '@/lib/plans';
import { planIntervalForProductId } from '@/lib/billing/polar-products';
import { isRedisConfigured, idempotencyOnce } from '@/lib/redis';
import {
  mapEventToIntent,
  resolveGroomerId,
  extractEventId,
  type PolarEvent,
} from '@/lib/billing/polar-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Polar webhook: POLAR_WEBHOOK_SECRET is not configured.');
    // No secret -> we cannot verify; ack 200 so Polar does not hammer retries.
    return NextResponse.json({ received: true, unverified: true }, { status: 200 });
  }

  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let event: PolarEvent;
  try {
    event = (await webhooks.validateEvent(rawBody, headers, secret)) as unknown as PolarEvent;
  } catch (err) {
    // Distinguish a real signature failure (reject 403) from the SDK not
    // recognizing the event type (a valid, signed event of a newer type) — the
    // latter should be acknowledged (200) and ignored, not treated as spoofed.
    if (err instanceof webhooks.PolarWebhookVerificationError) {
      console.error('Polar webhook: signature verification failed:', err);
      return NextResponse.json({ error: 'invalid signature' }, { status: 403 });
    }
    console.warn('Polar webhook: unrecognized/unparseable event, ignoring:', err);
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  try {
    await connectDB();

    // Fast idempotency guard (best-effort; fail-open when Redis is off).
    const eventId = extractEventId(event);
    if (eventId && isRedisConfigured()) {
      try {
        const first = await idempotencyOnce(`polar:${eventId}`);
        if (!first) {
          return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
        }
      } catch (idemErr) {
        console.warn('Polar webhook idempotency check failed (continuing):', idemErr);
      }
    }

    const groomerId = resolveGroomerId(event);
    if (!groomerId) {
      // Unresolvable account -> ack 200, no change.
      return NextResponse.json({ received: true, unresolved: true }, { status: 200 });
    }

    const intent = mapEventToIntent(event);
    if (!intent) {
      // Unknown / unhandled event -> ack 200, no change.
      return NextResponse.json({ received: true, ignored: true }, { status: 200 });
    }

    if (intent.kind === 'set-status') {
      const set: Record<string, unknown> = { status: intent.status };
      if (intent.productId) {
        const pi = planIntervalForProductId(intent.productId);
        if (pi) {
          set.plan = pi.plan;
          set.smsIncluded = PLANS[pi.plan].sms;
        }
      }
      if (intent.currentPeriodEnd) set.currentPeriodEnd = intent.currentPeriodEnd;
      if (intent.polarCustomerId) set.polarCustomerId = intent.polarCustomerId;
      if (intent.polarSubscriptionId) set.polarSubscriptionId = intent.polarSubscriptionId;
      await Subscription.findOneAndUpdate(
        { groomerId },
        { $set: set, $setOnInsert: { groomerId } },
        { upsert: true }
      );
    } else if (intent.kind === 'credit-topup') {
      await Subscription.findOneAndUpdate(
        { groomerId },
        { $inc: { smsTopupBalance: intent.messages }, $setOnInsert: { groomerId } },
        { upsert: true }
      );
    }

    await invalidateEntitlements(groomerId);
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    // A transient DB error -> 500 so Polar retries the delivery.
    console.error('Polar webhook processing failed:', err);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
