/**
 * Polar webhook (/api/polar/webhook) - subscriptions + SMS top-ups.
 *
 * Verifies the signed payload with the SDK's webhooks.validateEvent (we do NOT
 * use @polar-sh/nextjs - it needs Next 15/16; this app is Next 14), then drives
 * the same Subscription state machine the Stripe billing webhook does.
 *
 * Correctness guarantees:
 *  - Status comes from data.status (see polar-webhook.ts), never from the event
 *    name, so unpaid / past_due / ended subscriptions never grant access.
 *  - Out-of-order delivery: a subscription event older than the last one we
 *    applied (polarSyncedAt) is dropped, so a late retry of an "active" event
 *    cannot re-open access after a revoke.
 *  - Duplicate delivery: deduped by the Standard Webhooks "webhook-id" header
 *    (Redis, best-effort) and, for top-ups, durably by Polar order id so a
 *    retried order.paid never credits SMS twice.
 *  - Unknown event types and unresolvable accounts are acknowledged with 200.
 *  - Does NOT touch the Stripe deposit / Connect webhooks.
 */
import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
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
  type PolarEvent,
} from '@/lib/billing/polar-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** MongoDB duplicate-key error (unique groomerId index). */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 11000
  );
}

function ok(extra: Record<string, unknown> = {}): Response {
  return NextResponse.json({ received: true, ...extra }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Polar webhook: POLAR_WEBHOOK_SECRET is not configured.');
    // Return 500 so Polar keeps retrying until the secret is configured,
    // instead of silently dropping real payments.
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });
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
    if (err instanceof webhooks.PolarWebhookVerificationError) {
      console.error('Polar webhook: signature verification failed:', err);
      return NextResponse.json({ error: 'invalid signature' }, { status: 403 });
    }
    // A correctly signed event of a type this SDK version does not know.
    console.warn('Polar webhook: unrecognized event type, ignoring:', err);
    return ok({ ignored: true });
  }

  try {
    // Standard Webhooks delivery id: unique per event, stable across retries.
    const deliveryId = headers['webhook-id'];
    if (deliveryId && isRedisConfigured()) {
      try {
        if (!(await idempotencyOnce('polar:' + deliveryId))) return ok({ duplicate: true });
      } catch (idemErr) {
        console.warn('Polar webhook idempotency check failed (continuing):', idemErr);
      }
    }

    const intent = mapEventToIntent(event);
    if (!intent) return ok({ ignored: true });

    const groomerId = resolveGroomerId(event);
    if (!groomerId || !isValidObjectId(groomerId)) {
      console.warn('Polar webhook: could not resolve groomer for', event.type);
      return ok({ unresolved: true });
    }

    await connectDB();

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
      set.pastDueSince = intent.status === 'past_due' ? intent.pastDueSince : null;
      if (intent.eventAt) set.polarSyncedAt = intent.eventAt;

      // Only apply when this event is not older than the last one applied.
      const filter: Record<string, unknown> = { groomerId };
      if (intent.eventAt) {
        filter.$or = [
          { polarSyncedAt: null },
          { polarSyncedAt: { $exists: false } },
          { polarSyncedAt: { $lte: intent.eventAt } },
        ];
      }
      try {
        await Subscription.findOneAndUpdate(
          filter,
          { $set: set, $setOnInsert: { groomerId } },
          { upsert: true }
        );
      } catch (err) {
        // The row exists but is newer than this event: the upsert tried to
        // insert a second row for the groomer. Treat as stale and skip.
        if (isDuplicateKeyError(err)) return ok({ stale: true });
        throw err;
      }
    } else {
      try {
        await Subscription.findOneAndUpdate(
          { groomerId, polarTopupOrderIds: { $ne: intent.orderId } },
          {
            $inc: { smsTopupBalance: intent.messages },
            $push: { polarTopupOrderIds: intent.orderId },
            $setOnInsert: { groomerId },
          },
          { upsert: true }
        );
      } catch (err) {
        // This order was already credited.
        if (isDuplicateKeyError(err)) return ok({ duplicate: true });
        throw err;
      }
    }

    await invalidateEntitlements(groomerId);
    return ok();
  } catch (err) {
    // Transient failure -> 500 so Polar retries the delivery.
    console.error('Polar webhook processing failed:', err);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
