/**
 * Pure Polar-webhook logic (no DB / SDK / IO).
 *
 * Maps a verified Polar event into an intent the route applies to the
 * Subscription row, resolves the groomer id from the payload, and extracts a
 * stable event id for idempotency. Kept pure so it is unit/property testable
 * without a database or the Polar SDK.
 */
import { SMS_TOPUP } from '@/lib/plans';
import { isSmsTopupProduct } from '@/lib/billing/polar-products';

/** Loose shape of a Polar webhook payload (we read only what we need). */
export interface PolarEvent {
  type?: string;
  data?: Record<string, unknown>;
}

/** What the route should do in response to an event. */
export type WebhookIntent =
  | {
      kind: 'set-status';
      status: 'active' | 'canceled';
      productId?: string | null;
      currentPeriodEnd?: Date | null;
      polarCustomerId?: string | null;
      polarSubscriptionId?: string | null;
    }
  | { kind: 'credit-topup'; messages: number }
  | null;

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
function asDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve the groomer (User id) for an event. We set externalCustomerId =
 * groomerId and metadata.groomerId at checkout, so try, in order:
 * data.metadata.groomerId -> data.customer.externalId -> data.externalCustomerId
 * (and snake_case fallbacks). Returns null when unresolvable.
 */
export function resolveGroomerId(event: PolarEvent): string | null {
  const d = event.data ?? {};
  const meta = asRecord(d.metadata);
  const fromMeta = meta ? asString(meta.groomerId) : null;
  if (fromMeta) return fromMeta;
  const customer = asRecord(d.customer);
  const fromCustomer = customer
    ? asString(customer.externalId) ?? asString(customer.external_id)
    : null;
  if (fromCustomer) return fromCustomer;
  return (
    asString(d.externalCustomerId) ??
    asString(d.external_customer_id) ??
    asString(d.customerExternalId) ??
    null
  );
}

/** A stable id for idempotency (prefer event id, else subscription/order id). */
export function extractEventId(event: PolarEvent): string | null {
  const d = event.data ?? {};
  return (
    asString((event as Record<string, unknown>).id) ??
    asString(d.id) ??
    null
  );
}

/** Read the product id off a subscription/order payload (several shapes). */
function productIdOf(d: Record<string, unknown>): string | null {
  // subscription.product_id / productId, or nested product.id
  const direct = asString(d.productId) ?? asString(d.product_id);
  if (direct) return direct;
  const product = asRecord(d.product);
  return product ? asString(product.id) : null;
}

/** Read the current period end off a subscription payload. */
function currentPeriodEndOf(d: Record<string, unknown>): Date | null {
  return asDate(d.currentPeriodEnd) ?? asDate(d.current_period_end);
}

/**
 * Map a verified Polar event to an intent. PURE.
 *
 *  - subscription.created|updated|active|cycled -> set-status 'active'
 *  - subscription.canceled with cancel_at_period_end true -> stay 'active'
 *  - subscription.revoked -> set-status 'canceled' (read-only / ended)
 *  - order.paid for the SMS top-up product -> credit-topup
 *  - anything else -> null (unknown/unhandled)
 */
export function mapEventToIntent(event: PolarEvent): WebhookIntent {
  const type = event.type ?? '';
  const d = event.data ?? {};

  if (
    type === 'subscription.created' ||
    type === 'subscription.updated' ||
    type === 'subscription.active' ||
    type === 'subscription.cycled'
  ) {
    return {
      kind: 'set-status',
      status: 'active',
      productId: productIdOf(d),
      currentPeriodEnd: currentPeriodEndOf(d),
      polarCustomerId: asString(d.customerId) ?? asString(d.customer_id),
      polarSubscriptionId: asString(d.id),
    };
  }

  if (type === 'subscription.canceled') {
    // Cancel-at-period-end: still active until the period actually ends.
    const cancelAtPeriodEnd =
      d.cancelAtPeriodEnd === true || d.cancel_at_period_end === true;
    if (cancelAtPeriodEnd) {
      return {
        kind: 'set-status',
        status: 'active',
        productId: productIdOf(d),
        currentPeriodEnd: currentPeriodEndOf(d),
        polarSubscriptionId: asString(d.id),
      };
    }
    // Immediate cancellation -> ended.
    return { kind: 'set-status', status: 'canceled', polarSubscriptionId: asString(d.id) };
  }

  if (type === 'subscription.revoked') {
    return { kind: 'set-status', status: 'canceled', polarSubscriptionId: asString(d.id) };
  }

  if (type === 'order.paid') {
    const pid = productIdOf(d);
    if (pid && isSmsTopupProduct(pid)) {
      return { kind: 'credit-topup', messages: SMS_TOPUP.messages };
    }
    return null; // a subscription order's payment is handled via subscription.* events
  }

  return null;
}
