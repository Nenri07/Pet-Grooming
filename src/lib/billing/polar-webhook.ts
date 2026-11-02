/**
 * Pure Polar-webhook logic (no DB / SDK / IO).
 *
 * Maps a verified Polar event to an intent the route applies to the
 * Subscription row, and resolves the groomer id from the payload. Kept pure so
 * it is unit-testable without a database or the Polar SDK.
 *
 * Polar payloads are snake_case ({ type, timestamp, data }). The status written
 * to our Subscription comes from data.status — NOT from the event name — because
 * subscription.updated fires for every transition (including past_due and
 * canceled), and subscription.created fires while the first payment is still
 * "incomplete". Mapping by event name alone would grant access to unpaid or
 * ended subscriptions.
 */
import { SMS_TOPUP } from '@/lib/plans';
import { isSmsTopupProduct } from '@/lib/billing/polar-products';

/** Loose shape of a Polar webhook payload (we read only what we need). */
export interface PolarEvent {
  type?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
}

/** Our Subscription statuses that a Polar subscription can map to. */
export type MappedStatus = 'active' | 'past_due' | 'canceled';

/** What the route should do in response to an event. */
export type WebhookIntent =
  | {
      kind: 'set-status';
      status: MappedStatus;
      productId: string | null;
      currentPeriodEnd: Date | null;
      pastDueSince: Date | null;
      polarCustomerId: string | null;
      polarSubscriptionId: string | null;
      /** When Polar last modified the subscription; used to drop stale events. */
      eventAt: Date | null;
    }
  | { kind: 'credit-topup'; messages: number; orderId: string }
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
 * Map a Polar subscription status to ours, or null when the subscription is
 * not yet paid ("incomplete") and should not change access.
 */
export function mapPolarSubscriptionStatus(status: unknown): MappedStatus | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
    case 'paused':
      return 'canceled';
    default:
      // 'incomplete' (first payment pending) and unknown values: no change.
      return null;
  }
}

/**
 * Resolve the groomer (User id). Checkout sets both metadata.groomerId and
 * external_customer_id = groomerId; Polar copies checkout metadata onto the
 * resulting subscription and order. Returns null when unresolvable.
 */
export function resolveGroomerId(event: PolarEvent): string | null {
  const d = event.data ?? {};
  const meta = asRecord(d.metadata);
  const fromMeta = meta ? asString(meta.groomerId) : null;
  if (fromMeta) return fromMeta;
  const customer = asRecord(d.customer);
  const fromCustomer = customer
    ? asString(customer.external_id) ?? asString(customer.externalId)
    : null;
  if (fromCustomer) return fromCustomer;
  return asString(d.external_customer_id) ?? asString(d.externalCustomerId);
}

function productIdOf(d: Record<string, unknown>): string | null {
  const direct = asString(d.product_id) ?? asString(d.productId);
  if (direct) return direct;
  const product = asRecord(d.product);
  return product ? asString(product.id) : null;
}

/** Map a verified Polar event to an intent. PURE. */
export function mapEventToIntent(event: PolarEvent): WebhookIntent {
  const type = event.type ?? '';
  const d = event.data ?? {};

  if (type.startsWith('subscription.')) {
    const status = mapPolarSubscriptionStatus(d.status);
    if (!status) return null;
    const customer = asRecord(d.customer);
    return {
      kind: 'set-status',
      status,
      productId: productIdOf(d),
      currentPeriodEnd: asDate(d.current_period_end) ?? asDate(d.currentPeriodEnd),
      pastDueSince:
        status === 'past_due'
          ? asDate(d.past_due_at) ?? asDate(event.timestamp) ?? null
          : null,
      polarCustomerId:
        asString(d.customer_id) ?? (customer ? asString(customer.id) : null),
      polarSubscriptionId: asString(d.id),
      eventAt: asDate(d.modified_at) ?? asDate(event.timestamp),
    };
  }

  if (type === 'order.paid') {
    const pid = productIdOf(d);
    const orderId = asString(d.id);
    if (pid && orderId && isSmsTopupProduct(pid)) {
      return { kind: 'credit-topup', messages: SMS_TOPUP.messages, orderId };
    }
    // Subscription orders are reflected through the subscription.* events.
    return null;
  }

  return null;
}
