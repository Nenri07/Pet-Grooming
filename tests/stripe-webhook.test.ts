/**
 * Stripe webhook router integration + subscription-lifecycle handler tests
 * (task 4.5).
 *
 * HERMETIC: no real network, no real DB, no Redis. We mock, at the module
 * boundary, exactly the seams the route handler and the lifecycle handlers in
 * `./helpers` touch:
 *   - `@/lib/stripe/client`      → fake `getStripe().webhooks.constructEvent`
 *   - `@/lib/booking/fulfil`     → spy `fulfilBookingByPaymentIntentId`
 *   - `@/lib/redis`              → Redis unconfigured (skip the idempotency
 *                                   fast-path so each delivery reaches the
 *                                   switch), plus a no-op `idempotencyOnce`
 *   - `@/lib/db/connect`         → `connectDB` no-op (handlers await it)
 *   - `@/lib/db/models/subscription` → a controllable `Subscription.findOne`
 *     backed by an in-memory stub row with a mutable field set and a `save()`
 *     spy, matching how this project unit-tests DB-touching code (mock Mongoose
 *     rather than hit a real DB).
 *   - `@/lib/billing/entitlements` → spy `invalidateEntitlements`
 *   - `@/lib/db/models/transaction` → spy `Transaction.updateOne`
 *
 * What this covers:
 *   - R6.1/6.2 signature: missing header → 400; invalid signature → 400 and NO
 *     handler side effects.
 *   - R6.3 deposit path intact: `payment_intent.succeeded` still calls
 *     `fulfilBookingByPaymentIntentId` (subscription routing didn't break it).
 *   - Lifecycle status mapping on the IMPURE handlers:
 *     `handleSubscriptionChange` (active/past_due/canceled) + period/grace;
 *     `handleInvoicePaid` → active + pastDueSince cleared;
 *     `handleInvoicePaymentFailed` → past_due + pastDueSince set once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Mock seams. `vi.mock` factories are hoisted above everything, so the spies
// they reference must be created inside a `vi.hoisted` block (also hoisted) and
// shared through the returned object.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  constructEventMock: vi.fn<(raw: string, sig: string, secret: string) => unknown>(),
  fulfilMock: vi.fn<(pi: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true as const })),
  idempotencyOnce: vi.fn<() => Promise<boolean>>(async () => true),
  connectDB: vi.fn<() => Promise<undefined>>(async () => undefined),
  txUpdateOne: vi.fn<() => Promise<{ acknowledged: boolean }>>(async () => ({ acknowledged: true })),
  invalidateMock: vi.fn<(id: string) => Promise<undefined>>(async () => undefined),
  findOneMock: vi.fn<() => Promise<unknown>>(async () => null as unknown),
}));

const { constructEventMock, fulfilMock, txUpdateOne, invalidateMock, findOneMock } = h;

// Stripe client: constructEvent is driven per-test via `constructEventImpl`.
let constructEventImpl: (raw: string, sig: string, secret: string) => Stripe.Event;
constructEventMock.mockImplementation((raw: string, sig: string, secret: string) =>
  constructEventImpl(raw, sig, secret)
);
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({ webhooks: { constructEvent: h.constructEventMock } }),
}));

// Deposit fulfilment seam.
vi.mock('@/lib/booking/fulfil', () => ({
  fulfilBookingByPaymentIntentId: (pi: unknown) => h.fulfilMock(pi),
}));

// Redis: unconfigured so the route skips its idempotency fast-path and every
// delivery flows into the switch (lets us assert duplicate-delivery behaviour
// via the handlers themselves). idempotencyOnce is still provided as a no-op.
vi.mock('@/lib/redis', () => ({
  isRedisConfigured: () => false,
  idempotencyOnce: h.idempotencyOnce,
}));

// DB connect: no-op (handlers + route await it).
vi.mock('@/lib/db/connect', () => ({
  connectDB: h.connectDB,
}));

// Transaction model: only updateOne is used (markPaymentFailed).
vi.mock('@/lib/db/models/transaction', () => ({
  Transaction: { updateOne: h.txUpdateOne },
}));

// Entitlements cache invalidation seam.
vi.mock('@/lib/billing/entitlements', () => ({
  invalidateEntitlements: (id: string) => h.invalidateMock(id),
}));

// Subscription model: findOne returns whatever `findOneResult` is set to.
let findOneResult: unknown = null;
findOneMock.mockImplementation(async () => findOneResult);
vi.mock('@/lib/db/models/subscription', () => ({
  Subscription: { findOne: h.findOneMock },
}));

// Import the subjects AFTER the mocks are registered.
import { POST } from '@/app/api/webhooks/stripe/route';
import {
  handleSubscriptionChange,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '@/app/api/webhooks/stripe/helpers';

// ---------------------------------------------------------------------------
// Test fixtures / helpers.
// ---------------------------------------------------------------------------

/** A mutable stub Subscription "row" with a save() spy, mimicking a Mongoose doc. */
type MockRow = {
  groomerId: unknown;
  status: string;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  trialEndsAt?: Date | null;
  trialDeadline?: Date | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  save: ReturnType<typeof vi.fn>;
};

function makeRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    groomerId: 'groomer_1',
    status: 'trialing',
    currentPeriodEnd: null,
    pastDueSince: null,
    stripeSubscriptionId: 'sub_123',
    stripeCustomerId: 'cus_123',
    save: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Build a fake Stripe.Subscription with a given status + per-item period end. */
function fakeSub(status: string, periodEndUnix?: number): Stripe.Subscription {
  return {
    id: 'sub_123',
    customer: 'cus_123',
    status,
    items: {
      data:
        periodEndUnix != null
          ? [{ current_period_end: periodEndUnix }]
          : [],
    },
  } as unknown as Stripe.Subscription;
}

/** Build a fake Stripe.Invoice carrying the originating subscription + period. */
function fakeInvoice(periodEndUnix?: number): Stripe.Invoice {
  return {
    customer: 'cus_123',
    parent: { subscription_details: { subscription: 'sub_123' } },
    lines: {
      data: periodEndUnix != null ? [{ period: { end: periodEndUnix } }] : [],
    },
    period_end: periodEndUnix,
  } as unknown as Stripe.Invoice;
}

/** POST a raw body to the route handler with optional stripe-signature header. */
function post(body: string, signature: string | null): Promise<Response> {
  const headers = new Headers();
  if (signature !== null) headers.set('stripe-signature', signature);
  const req = new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    headers,
    body,
  });
  return POST(req);
}

const OLD_ENV = process.env.STRIPE_WEBHOOK_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  findOneResult = null;
  constructEventImpl = () => {
    throw new Error('constructEvent not configured for this test');
  };
  // clearAllMocks wipes implementations; restore the delegating ones.
  constructEventMock.mockImplementation((raw: string, sig: string, secret: string) =>
    constructEventImpl(raw, sig, secret)
  );
  fulfilMock.mockResolvedValue({ ok: true as const });
  txUpdateOne.mockResolvedValue({ acknowledged: true });
  invalidateMock.mockResolvedValue(undefined);
  findOneMock.mockImplementation(async () => findOneResult);
});

afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = OLD_ENV;
});

// ---------------------------------------------------------------------------
// R6.1 / R6.2 — signature verification
// ---------------------------------------------------------------------------
describe('Stripe webhook route: signature verification (R6.1/6.2)', () => {
  it('returns 400 when the stripe-signature header is missing', async () => {
    const res = await post('{}', null);
    expect(res.status).toBe(400);
    // No verification was attempted and no side effects fired.
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(fulfilMock).not.toHaveBeenCalled();
    expect(findOneMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('returns 400 and performs NO handler side effects on an invalid signature', async () => {
    constructEventImpl = () => {
      throw new Error('No signatures found matching the expected signature');
    };
    const res = await post('{"id":"evt_bad"}', 'bad-signature');
    expect(res.status).toBe(400);
    expect(constructEventMock).toHaveBeenCalledTimes(1);
    // Nothing downstream of verification ran.
    expect(fulfilMock).not.toHaveBeenCalled();
    expect(txUpdateOne).not.toHaveBeenCalled();
    expect(findOneMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the webhook secret is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await post('{}', 'sig');
    expect(res.status).toBe(500);
    expect(constructEventMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R6.3 — deposit path intact (subscription routing didn't break deposits)
// ---------------------------------------------------------------------------
describe('Stripe webhook route: deposit fulfilment stays intact (R6.3)', () => {
  it('routes payment_intent.succeeded to fulfilBookingByPaymentIntentId', async () => {
    const pi = { id: 'pi_abc' } as Stripe.PaymentIntent;
    constructEventImpl = () =>
      ({
        id: 'evt_pi_ok',
        type: 'payment_intent.succeeded',
        data: { object: pi },
      }) as unknown as Stripe.Event;

    const res = await post('{"id":"evt_pi_ok"}', 'good-sig');
    expect(res.status).toBe(200);
    expect(fulfilMock).toHaveBeenCalledTimes(1);
    expect(fulfilMock).toHaveBeenCalledWith(pi);
    // Subscription handlers never ran for a deposit event.
    expect(findOneMock).not.toHaveBeenCalled();
  });

  it('routes payment_intent.payment_failed to Transaction.updateOne (no fulfilment)', async () => {
    const pi = { id: 'pi_fail' } as Stripe.PaymentIntent;
    constructEventImpl = () =>
      ({
        id: 'evt_pi_fail',
        type: 'payment_intent.payment_failed',
        data: { object: pi },
      }) as unknown as Stripe.Event;

    const res = await post('{"id":"evt_pi_fail"}', 'good-sig');
    expect(res.status).toBe(200);
    expect(txUpdateOne).toHaveBeenCalledTimes(1);
    expect(fulfilMock).not.toHaveBeenCalled();
  });

  it('routes customer.subscription.updated to the subscription handler (not deposits)', async () => {
    findOneResult = makeRow({ status: 'trialing' });
    constructEventImpl = () =>
      ({
        id: 'evt_sub_upd',
        type: 'customer.subscription.updated',
        data: { object: fakeSub('active') },
      }) as unknown as Stripe.Event;

    const res = await post('{"id":"evt_sub_upd"}', 'good-sig');
    expect(res.status).toBe(200);
    expect(findOneMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledTimes(1);
    // The deposit path was NOT taken.
    expect(fulfilMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle status mapping — the impure handlers over a mock row
// ---------------------------------------------------------------------------
describe('handleSubscriptionChange: status/period/grace mapping', () => {
  const NOW = new Date('2025-06-15T12:00:00.000Z');
  const PERIOD_END_UNIX = Math.floor(Date.parse('2025-07-15T12:00:00.000Z') / 1000);

  it('maps active, refreshes currentPeriodEnd, and clears pastDueSince', async () => {
    const row = makeRow({ status: 'trialing', pastDueSince: new Date('2025-06-01T00:00:00Z') });
    findOneResult = row;

    await handleSubscriptionChange(fakeSub('active', PERIOD_END_UNIX), NOW);

    expect(row.status).toBe('active');
    expect(row.currentPeriodEnd?.getTime()).toBe(PERIOD_END_UNIX * 1000);
    expect(row.pastDueSince).toBeNull();
    expect(row.save).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledWith('groomer_1');
  });

  it('maps past_due and sets pastDueSince to now when not already set', async () => {
    const row = makeRow({ status: 'active', pastDueSince: null });
    findOneResult = row;

    await handleSubscriptionChange(fakeSub('past_due'), NOW);

    expect(row.status).toBe('past_due');
    expect(row.pastDueSince?.getTime()).toBe(NOW.getTime());
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  it('does not move an already-set pastDueSince on a repeat past_due', async () => {
    const anchor = new Date('2025-06-10T00:00:00.000Z');
    const row = makeRow({ status: 'past_due', pastDueSince: anchor });
    findOneResult = row;

    await handleSubscriptionChange(fakeSub('past_due'), NOW);

    expect(row.status).toBe('past_due');
    expect(row.pastDueSince?.getTime()).toBe(anchor.getTime());
  });

  it('maps canceled and clears the grace anchor', async () => {
    const row = makeRow({ status: 'past_due', pastDueSince: new Date('2025-06-10T00:00:00Z') });
    findOneResult = row;

    await handleSubscriptionChange(fakeSub('canceled'), NOW);

    expect(row.status).toBe('canceled');
    expect(row.pastDueSince).toBeNull();
  });

  it('leaves currentPeriodEnd untouched when the event carries no period', async () => {
    const existing = new Date('2025-05-01T00:00:00.000Z');
    const row = makeRow({ status: 'trialing', currentPeriodEnd: existing });
    findOneResult = row;

    await handleSubscriptionChange(fakeSub('active'), NOW); // no period in items

    expect(row.status).toBe('active');
    expect(row.currentPeriodEnd?.getTime()).toBe(existing.getTime());
  });

  it('no-ops (no save/invalidate) when there is no local row', async () => {
    findOneResult = null;
    await handleSubscriptionChange(fakeSub('active'), NOW);
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

describe('handleInvoicePaid: active + period advance + grace clear', () => {
  const PERIOD_END_UNIX = Math.floor(Date.parse('2025-08-15T12:00:00.000Z') / 1000);

  it('sets active, advances currentPeriodEnd, and clears pastDueSince', async () => {
    const row = makeRow({ status: 'past_due', pastDueSince: new Date('2025-06-01T00:00:00Z') });
    findOneResult = row;

    await handleInvoicePaid(fakeInvoice(PERIOD_END_UNIX));

    expect(row.status).toBe('active');
    expect(row.currentPeriodEnd?.getTime()).toBe(PERIOD_END_UNIX * 1000);
    expect(row.pastDueSince).toBeNull();
    expect(row.save).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledWith('groomer_1');
  });
});

describe('handleInvoicePaymentFailed: past_due + anchor set once', () => {
  const NOW = new Date('2025-06-15T12:00:00.000Z');
  const LATER = new Date('2025-06-18T12:00:00.000Z');

  it('sets past_due and anchors pastDueSince to now on first failure', async () => {
    const row = makeRow({ status: 'active', pastDueSince: null });
    findOneResult = row;

    await handleInvoicePaymentFailed(fakeInvoice(), NOW);

    expect(row.status).toBe('past_due');
    expect(row.pastDueSince?.getTime()).toBe(NOW.getTime());
  });

  it('does not reset pastDueSince on a second failure', async () => {
    const row = makeRow({ status: 'active', pastDueSince: null });
    findOneResult = row;

    await handleInvoicePaymentFailed(fakeInvoice(), NOW);
    await handleInvoicePaymentFailed(fakeInvoice(), LATER);

    expect(row.status).toBe('past_due');
    // Still anchored to the FIRST failure, not the later retry.
    expect(row.pastDueSince?.getTime()).toBe(NOW.getTime());
  });
});
