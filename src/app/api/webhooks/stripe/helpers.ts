/**
 * Pure helpers for the Stripe webhook router (POST /api/webhooks/stripe).
 *
 * These functions are intentionally PURE — no I/O, no Mongoose, no Stripe SDK
 * calls — so they can be exhaustively property-tested in isolation and reused
 * by the webhook route without pulling in side effects.
 *
 * _Design: Stripe Flows (c) — Subscription lifecycle webhooks → local status_
 */
import type { SubscriptionStatus } from '@/lib/db/models/subscription';

/**
 * Totally map a Stripe subscription `status` string into the local
 * `SubscriptionStatus` enum ({trialing, active, past_due, canceled, expired}).
 *
 * The mapping is TOTAL: every Stripe status — and any unrecognised/unknown
 * string Stripe may introduce in the future — resolves to a defined local
 * value, so the webhook router never has to branch on "unexpected" input.
 *
 * Mapping (and the rationale for the non-obvious choices):
 *   - `trialing`            → `trialing`
 *   - `active`              → `active`
 *   - `past_due`            → `past_due`
 *   - `unpaid`              → `past_due`  (still "needs payment", stays in grace)
 *   - `incomplete`          → `past_due`  (initial payment not yet confirmed; we
 *                                          treat it as "needs payment" rather
 *                                          than granting a fresh trial, so the
 *                                          account is in the grace window, not
 *                                          silently usable)
 *   - `incomplete_expired`  → `expired`   (the initial payment window lapsed)
 *   - `canceled`            → `canceled`
 *   - `paused`             → `canceled`   (a paused subscription is not billing
 *                                          and grants no access; treated as a
 *                                          read-only canceled state)
 *   - any UNKNOWN string    → `expired`   (safe, non-usable default: an
 *                                          unrecognised status must never grant
 *                                          access — fail closed to read-only)
 *
 * @param stripeStatus Raw Stripe subscription status string (e.g. from
 *   `customer.subscription.updated`). Any string is accepted.
 * @returns The corresponding local {@link SubscriptionStatus}.
 *
 * _Requirements: 5.2, 5.3, 5.4_
 */
export function mapStripeSubStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    case 'incomplete_expired':
      return 'expired';
    case 'canceled':
    case 'paused':
      return 'canceled';
    default:
      // Unknown / future Stripe statuses fail closed to a non-usable state so
      // an unrecognised value can never accidentally grant portal access.
      return 'expired';
  }
}

// ---------------------------------------------------------------------------
// IMPURE subscription-lifecycle handlers (DB + Redis side).
//
// These live alongside the pure `mapStripeSubStatus` above but, unlike it, DO
// perform I/O (Mongoose + the entitlements cache). They are kept as small,
// individually-exported async functions so the webhook route (route.ts) stays a
// thin switch and each handler is independently testable. They are additive and
// do NOT touch the existing deposit (`payment_intent.*`) fulfilment path.
//
// Lookups: subscription events carry a Stripe.Subscription (`id`, `customer`,
// `status`, and — in the installed Stripe API version — a per-item
// `current_period_end` on `items.data[]`, NOT a top-level field). Invoice events
// carry a Stripe.Invoice whose originating subscription lives under
// `parent.subscription_details.subscription`, with period boundaries on the line
// items / `period_end`.
//
// Idempotency: the route's `idempotencyOnce(event.id)` fast-path guards
// duplicate deliveries; every write below is a state-SET (not an increment), so
// re-processing converges to the same final row. Callers surface transient
// failures as 5xx so Stripe retries (R5.7). Webhook state is source of truth
// (R5.8).
//
// _Design: Stripe Flows (c) — Subscription lifecycle webhooks → local status_
// _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3_
// ---------------------------------------------------------------------------
import type Stripe from 'stripe';
import type { FilterQuery } from 'mongoose';
import { connectDB } from '@/lib/db/connect';
import { Subscription, type ISubscription } from '@/lib/db/models/subscription';
import { invalidateEntitlements } from '@/lib/billing/entitlements';

/** Narrow a Stripe id-or-expanded-object union down to the string id. */
function idOf(
  value: string | { id?: string } | null | undefined
): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return typeof value.id === 'string' ? value.id : null;
}

/** Convert a Stripe unix-seconds timestamp into a `Date`, or `null`. */
function unixToDate(seconds: number | null | undefined): Date | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

/**
 * The current-period end for a Stripe.Subscription. In the installed Stripe API
 * version this is a per-item field (`items.data[].current_period_end`) rather
 * than a top-level one, so we take the latest end across the subscription's
 * items. Returns `null` when unavailable (we then leave the stored value alone).
 */
function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const items = sub.items?.data ?? [];
  let latest: number | null = null;
  for (const item of items) {
    const end = (item as { current_period_end?: number }).current_period_end;
    if (typeof end === 'number' && (latest == null || end > latest)) {
      latest = end;
    }
  }
  return unixToDate(latest);
}

/**
 * The period end an invoice advances the subscription to: the latest line-item
 * period end if present, else the invoice-level `period_end`.
 */
function invoicePeriodEnd(invoice: Stripe.Invoice): Date | null {
  const lines = invoice.lines?.data ?? [];
  let latest: number | null = null;
  for (const line of lines) {
    const end = (line as { period?: { end?: number } }).period?.end;
    if (typeof end === 'number' && (latest == null || end > latest)) {
      latest = end;
    }
  }
  if (latest != null) return unixToDate(latest);
  return unixToDate((invoice as { period_end?: number }).period_end);
}

/** The subscription id an invoice was generated by, if any. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = (
    invoice as {
      parent?: { subscription_details?: { subscription?: string | { id?: string } } | null } | null;
    }
  ).parent;
  return idOf(parent?.subscription_details?.subscription ?? null);
}

/**
 * Locate the local Subscription row for a webhook, by `stripeSubscriptionId`
 * first and `stripeCustomerId` as a fallback (both are sparse-indexed). Returns
 * `null` when neither matches — the webhook is for a subscription we never
 * provisioned locally, which we acknowledge without error.
 */
async function findLocalSubscription(
  stripeSubscriptionId: string | null,
  stripeCustomerId: string | null
) {
  const or: FilterQuery<ISubscription>[] = [];
  if (stripeSubscriptionId) or.push({ stripeSubscriptionId });
  if (stripeCustomerId) or.push({ stripeCustomerId });
  if (or.length === 0) return null;
  return Subscription.findOne({ $or: or });
}

/**
 * Handle `customer.subscription.created|updated|deleted`.
 *
 * Sets `status = mapStripeSubStatus(sub.status)`, refreshes `currentPeriodEnd`
 * (when the event carries one), and manages the `past_due` grace anchor:
 *   - entering `past_due` AND `pastDueSince` not already set → set it to now;
 *   - leaving `past_due` (any other status) → clear `pastDueSince` to null.
 * Also carries the Stripe ids forward so a row first matched by customer id
 * gains its subscription id. Invalidates the entitlements cache on any change.
 *
 * `.deleted` arrives with `sub.status === 'canceled'`, which maps to the local
 * `canceled` state via the same `mapStripeSubStatus`.
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1_
 */
export async function handleSubscriptionChange(
  sub: Stripe.Subscription,
  now: Date = new Date()
): Promise<void> {
  await connectDB();
  const stripeSubscriptionId = typeof sub.id === 'string' ? sub.id : null;
  const stripeCustomerId = idOf(sub.customer);

  const row = await findLocalSubscription(stripeSubscriptionId, stripeCustomerId);
  if (!row) {
    console.warn(
      `Stripe webhook: no local Subscription for sub=${stripeSubscriptionId ?? '?'} cust=${stripeCustomerId ?? '?'}; skipping.`
    );
    return;
  }

  const status = mapStripeSubStatus(sub.status);
  row.status = status;

  const periodEnd = subscriptionPeriodEnd(sub);
  if (periodEnd) row.currentPeriodEnd = periodEnd;

  // Keep Stripe ids in sync (a row first matched by customer id learns its sub).
  if (stripeSubscriptionId) row.stripeSubscriptionId = stripeSubscriptionId;
  if (stripeCustomerId) row.stripeCustomerId = stripeCustomerId;

  // Grace-window anchor: set on first entry to past_due, clear on exit.
  if (status === 'past_due') {
    if (!row.pastDueSince) row.pastDueSince = now;
  } else {
    row.pastDueSince = null;
  }

  await row.save();
  await invalidateEntitlements(String(row.groomerId));
}

/**
 * Handle `invoice.paid`: the subscription is paid through its new period. Set
 * `status = active`, advance `currentPeriodEnd` to the invoice's period end
 * when known, and clear the `pastDueSince` grace anchor. Invalidates the cache.
 *
 * _Requirements: 5.2, 5.5, 5.6, 6.1_
 */
export async function handleInvoicePaid(
  invoice: Stripe.Invoice
): Promise<void> {
  await connectDB();
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  const stripeCustomerId = idOf(invoice.customer);

  const row = await findLocalSubscription(stripeSubscriptionId, stripeCustomerId);
  if (!row) {
    console.warn(
      `Stripe webhook: invoice.paid for unknown sub=${stripeSubscriptionId ?? '?'} cust=${stripeCustomerId ?? '?'}; skipping.`
    );
    return;
  }

  row.status = 'active';
  const periodEnd = invoicePeriodEnd(invoice);
  if (periodEnd) row.currentPeriodEnd = periodEnd;
  row.pastDueSince = null;
  if (stripeSubscriptionId) row.stripeSubscriptionId = stripeSubscriptionId;
  if (stripeCustomerId) row.stripeCustomerId = stripeCustomerId;

  await row.save();
  await invalidateEntitlements(String(row.groomerId));
}

/**
 * Handle `invoice.payment_failed`: the renewal charge failed. Set
 * `status = past_due` and anchor the grace window with `pastDueSince = now`
 * (only if not already set, so retries don't reset the clock). Invalidates the
 * cache.
 *
 * _Requirements: 5.4, 5.6, 6.1_
 */
export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  now: Date = new Date()
): Promise<void> {
  await connectDB();
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  const stripeCustomerId = idOf(invoice.customer);

  const row = await findLocalSubscription(stripeSubscriptionId, stripeCustomerId);
  if (!row) {
    console.warn(
      `Stripe webhook: invoice.payment_failed for unknown sub=${stripeSubscriptionId ?? '?'} cust=${stripeCustomerId ?? '?'}; skipping.`
    );
    return;
  }

  row.status = 'past_due';
  if (!row.pastDueSince) row.pastDueSince = now;
  if (stripeSubscriptionId) row.stripeSubscriptionId = stripeSubscriptionId;
  if (stripeCustomerId) row.stripeCustomerId = stripeCustomerId;

  await row.save();
  await invalidateEntitlements(String(row.groomerId));
}

/**
 * Handle `customer.subscription.trial_will_end`: Stripe's "trial ends soon"
 * signal (fired ~3 days out). The trial countdown + lockout are driven by the
 * stored `trialDeadline` and the pure `evaluateAccess`, so no status change is
 * needed here. We keep this handler minimal — log the signal and invalidate the
 * entitlements cache so the next read re-derives the countdown — and
 * deliberately add NO new Subscription model field for it (the deadline already
 * carries the information a notification/countdown needs).
 *
 * NOTE: a dedicated notification side-effect (email/SMS "trial ending") can hang
 * off this hook later; for Phase 1 it is a log + cache-invalidate only.
 *
 * _Requirements: 5.5, 6.1_
 */
export async function handleTrialWillEnd(
  sub: Stripe.Subscription
): Promise<void> {
  await connectDB();
  const stripeSubscriptionId = typeof sub.id === 'string' ? sub.id : null;
  const stripeCustomerId = idOf(sub.customer);

  const row = await findLocalSubscription(stripeSubscriptionId, stripeCustomerId);
  if (!row) {
    console.warn(
      `Stripe webhook: trial_will_end for unknown sub=${stripeSubscriptionId ?? '?'} cust=${stripeCustomerId ?? '?'}; skipping.`
    );
    return;
  }

  console.info(
    `Stripe webhook: trial_will_end for groomer=${String(row.groomerId)} (deadline=${
      row.trialDeadline?.toISOString() ?? row.trialEndsAt?.toISOString() ?? 'unknown'
    }).`
  );
  await invalidateEntitlements(String(row.groomerId));
}
