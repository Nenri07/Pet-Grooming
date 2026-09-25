/**
 * Stripe BILLING webhook (POST /api/stripe/billing-webhook) — Master Spec §13.2.
 *
 * Handles subscription lifecycle events for PawPort's OWN plans (distinct from
 * the client-deposit PaymentIntent webhook at /api/webhooks/stripe, which is
 * untouched). It verifies the Stripe signature, is idempotent (reuses the Redis
 * `idem:stripe:{eventId}` guard), updates the {@link Subscription} row, and
 * invalidates the cached entitlements so the next request reflects the change.
 *
 * Signing secret: uses `STRIPE_BILLING_WEBHOOK_SECRET` when set; otherwise
 * falls back to `STRIPE_WEBHOOK_SECRET`. Configure a SEPARATE billing endpoint
 * secret in production so billing and deposit webhooks can be rotated
 * independently — the fallback only exists to ease local/dev setup.
 *
 * Degradation: if NO signing secret is configured at all, the endpoint returns
 * 200 (no-op) so an unconfigured deployment does not error or cause Stripe to
 * retry against a broken endpoint.
 *
 * Handled events (§13.2):
 *   - checkout.session.completed            → link customer/subscription
 *   - customer.subscription.created|updated → sync plan/status/period
 *   - customer.subscription.deleted         → mark canceled
 *   - invoice.paid                          → active + advance period
 *   - invoice.payment_failed                → past_due (starts 7-day grace)
 *   - customer.subscription.trial_will_end  → email reminder (3 days before)
 *
 * _Master Spec: §13.2, §13.4, §15_
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { connectDB } from '@/lib/db/connect';
import { Subscription, type SubscriptionStatus } from '@/lib/db/models/subscription';
import { User } from '@/lib/db/models/user';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { invalidateEntitlements } from '@/lib/billing/entitlements';
import { sendTrialEndingEmail } from '@/lib/email/send';
import { PLANS, SMS_TOPUP, type PlanName } from '@/lib/plans';
import { idempotencyOnce, isRedisConfigured } from '@/lib/redis';

// Stripe SDK + Mongoose require the Node.js runtime; never cache a webhook.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The billing webhook secret, preferring the dedicated one (documented above). */
function billingWebhookSecret(): string | undefined {
  return process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
}

/** Map a Stripe subscription status to our lifecycle status (§13.2). */
function mapStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
    case 'paused':
    default:
      // Unknown/edge states: treat as canceled (read-only) — safest default.
      return 'canceled';
  }
}

/**
 * Infer our plan name from a subscription's price id by matching against the
 * configured price envs. Falls back to `pro` (the trial tier) when unknown so a
 * groomer is never accidentally downgraded below what they paid for.
 */
function planFromPriceId(priceId: string | null | undefined): PlanName {
  if (!priceId) return 'pro';
  const map: Record<string, PlanName> = {};
  const solo = [process.env.STRIPE_PRICE_SOLO_MONTH, process.env.STRIPE_PRICE_SOLO_YEAR];
  const pro = [process.env.STRIPE_PRICE_PRO_MONTH, process.env.STRIPE_PRICE_PRO_YEAR];
  for (const id of solo) if (id) map[id.trim()] = 'solo';
  for (const id of pro) if (id) map[id.trim()] = 'pro';
  return map[priceId] ?? 'pro';
}

/**
 * Read the current-period-end (unix seconds) from a subscription across Stripe
 * API versions: recent versions put it on the subscription ITEM, older versions
 * on the subscription itself. Returns null when neither carries it.
 */
function readPeriodEnd(
  sub: Stripe.Subscription,
  item: Stripe.SubscriptionItem | undefined
): number | null {
  const itemEnd = (item as { current_period_end?: number } | undefined)?.current_period_end;
  if (typeof itemEnd === 'number') return itemEnd;
  const subEnd = (sub as { current_period_end?: number }).current_period_end;
  return typeof subEnd === 'number' ? subEnd : null;
}

/** Resolve the groomerId for a Stripe customer from metadata or our row. */
async function resolveGroomerId(
  customerId: string | null,
  metadataGroomerId?: string | null
): Promise<string | null> {
  if (metadataGroomerId) return metadataGroomerId;
  if (!customerId) return null;
  const row = await Subscription.findOne({ stripeCustomerId: customerId })
    .select('groomerId')
    .lean<{ groomerId: unknown } | null>();
  return row ? String(row.groomerId) : null;
}

/** Upsert the Subscription row for a groomer and bust the entitlement cache. */
async function upsertSubscription(
  groomerId: string,
  set: Record<string, unknown>
): Promise<void> {
  await Subscription.findOneAndUpdate(
    { groomerId },
    { $set: set, $setOnInsert: { groomerId } },
    { upsert: true }
  );
  await invalidateEntitlements(groomerId);
}

/** Sync a Stripe Subscription object into our row (created|updated). */
async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const groomerId = await resolveGroomerId(
    customerId,
    (sub.metadata?.groomerId as string) ?? null
  );
  if (!groomerId) {
    console.error('[billing-webhook] no groomer for subscription', sub.id);
    return;
  }

  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = planFromPriceId(priceId);
  const status = mapStatus(sub.status);
  // Stripe timestamps are seconds; convert to Date. In recent Stripe API
  // versions the period end lives on the subscription ITEM; older versions
  // expose it on the subscription. Read whichever is present.
  const periodEndSec = readPeriodEnd(sub, item);
  const periodEnd = periodEndSec ? new Date(periodEndSec * 1000) : null;
  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

  await upsertSubscription(groomerId, {
    plan,
    status,
    smsIncluded: PLANS[plan].sms,
    currentPeriodEnd: periodEnd,
    trialEndsAt: trialEnd,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
  });
}

/** Handle checkout.session.completed (subscription link + SMS top-up credit). */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  const groomerId = await resolveGroomerId(
    customerId,
    (session.metadata?.groomerId as string) ?? session.client_reference_id ?? null
  );
  if (!groomerId) {
    console.error('[billing-webhook] no groomer for checkout session', session.id);
    return;
  }

  // One-time SMS top-up (§13.4): credit the balance rather than touching plan.
  if (session.metadata?.kind === 'sms_topup') {
    const messages = Number(session.metadata?.messages) || SMS_TOPUP.messages;
    await Subscription.findOneAndUpdate(
      { groomerId },
      { $inc: { smsTopupBalance: messages }, $setOnInsert: { groomerId } },
      { upsert: true }
    );
    await invalidateEntitlements(groomerId);
    return;
  }

  // Subscription checkout: persist the customer/subscription ids. The
  // subscription.created/updated event carries the full detail we sync there.
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;
  await upsertSubscription(groomerId, {
    stripeCustomerId: customerId,
    ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
  });
}

/** Handle invoice.paid → active + advance period end. */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
  const groomerId = await resolveGroomerId(customerId);
  if (!groomerId) return;

  const line = invoice.lines?.data?.[0];
  const periodEnd = line?.period?.end ? new Date(line.period.end * 1000) : null;
  await upsertSubscription(groomerId, {
    status: 'active',
    ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
  });
}

/** Handle invoice.payment_failed → past_due (starts the 7-day grace, §13.2). */
async function handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
  const groomerId = await resolveGroomerId(customerId);
  if (!groomerId) return;
  await upsertSubscription(groomerId, { status: 'past_due' });
}

/** Handle customer.subscription.deleted → canceled (read-only, §13.2). */
async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const groomerId = await resolveGroomerId(
    customerId,
    (sub.metadata?.groomerId as string) ?? null
  );
  if (!groomerId) return;
  await upsertSubscription(groomerId, { status: 'canceled' });
}

/** Handle customer.subscription.trial_will_end → email reminder (§13.2). */
async function handleTrialWillEnd(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const groomerId = await resolveGroomerId(
    customerId,
    (sub.metadata?.groomerId as string) ?? null
  );
  if (!groomerId) return;

  const user = await User.findById(groomerId).select('email').lean<{ email?: string } | null>();
  const profile = await GroomerProfile.findOne({ userId: groomerId })
    .select('businessEmail')
    .lean<{ businessEmail?: string } | null>();
  const to = profile?.businessEmail || user?.email;
  if (!to) return;

  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const trialEndsOn = trialEnd
    ? trialEnd.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : 'soon';
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';

  // Best-effort; sendTrialEndingEmail never throws.
  await sendTrialEndingEmail(to, { trialEndsOn, billingUrl: `${base}/billing` });
}

export async function POST(req: Request): Promise<Response> {
  const secret = billingWebhookSecret();
  // Unconfigured: no-op 200 so the deployment does not error (degradation).
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
    console.error('[billing-webhook] signature verification failed:', message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  // Idempotency: claim the event id once (best-effort; fail open).
  if (isRedisConfigured()) {
    try {
      const first = await idempotencyOnce(event.id);
      if (!first) {
        return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
      }
    } catch (idemErr) {
      console.error('[billing-webhook] idempotency check failed; proceeding:', idemErr);
    }
  }

  try {
    await connectDB();
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoiceFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object as Stripe.Subscription);
        break;
      default:
        // Acknowledge unhandled types so Stripe stops retrying.
        break;
    }
  } catch (err) {
    console.error(`[billing-webhook] error handling ${event.type}:`, err);
    // 500 asks Stripe to retry; handlers are idempotent so a retry is safe.
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
