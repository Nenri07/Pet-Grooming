/**
 * Phase-3 Stripe Connect: direct-charge deposit gate + `account.updated`
 * webhook sync tests (task 13.5).
 *
 * HERMETIC: no real network, no real DB, no Redis, no Stripe SDK. We mock, at
 * the module boundary, exactly the seams the two subjects touch — mirroring the
 * established pattern in `tests/stripe-webhook.test.ts` (`vi.hoisted` spies +
 * `vi.mock` factories, controllable per-test via module-scope `let`s).
 *
 * Subjects:
 *   1. `handleAccountUpdated(account)` from the webhook helpers — syncs a
 *      GroomerProfile's `connectStatus` + `stripeConnectChargesEnabled` from a
 *      Stripe.Account, idempotently (R15.4 / R15.5).
 *   2. `createDepositPaymentIntent(slug, booking)` from `@/lib/stripe/helpers` —
 *      the deposit gate: blocks (no charge, no PendingBooking) when the groomer's
 *      Connect account is not `complete` (R16.1 / R17.1), and creates a DIRECT
 *      CHARGE on the connected account (`{ stripeAccount }`) with NO
 *      `application_fee_amount` at the launch 0% fee once Connect is complete
 *      (R16.2).
 *
 * Seams mocked:
 *   - `@/lib/db/connect`                  → `connectDB` no-op
 *   - `@/lib/db/models/groomer-profile`   → controllable `GroomerProfile.findOne`
 *     (a mutable stub row with a `save()` spy for the webhook; a chainable
 *     `.select().lean()` query returning the gate's profile view for the helper)
 *   - `@/lib/stripe/client`               → `isStripeConfigured` true, `getStripe`
 *     returns a stub whose `paymentIntents.create/update` are spies
 *   - `@/lib/db/models/pending-booking`   → spy `PendingBooking.findOneAndUpdate`
 *   - `@/lib/redis`                       → `isRedisConfigured` false (no hold path)
 *   - `@/lib/calendar/holds`              → inert `createHold` + real-shaped `SlotHeldError`
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { ConnectStatus } from '@/lib/billing/connect';

// ---------------------------------------------------------------------------
// Hoisted spies shared with the (hoisted) vi.mock factories.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  connectDB: vi.fn<() => Promise<undefined>>(async () => undefined),
  // GroomerProfile.findOne is overloaded across the two subjects:
  //  - webhook handler calls `.findOne(filter)` and awaits the result directly;
  //  - deposit helper calls `.findOne(filter).select(...).lean()`.
  // A single spy returns whatever the per-test `findOneReturn` provides.
  profileFindOne: vi.fn(),
  piCreate:
    vi.fn<(params: unknown, opts?: unknown) => Promise<{ id: string; client_secret: string | null }>>(),
  piUpdate: vi.fn<(id: string, params: unknown, opts?: unknown) => Promise<{ id: string }>>(),
  pendingUpsert: vi.fn<(filter: unknown, update: unknown, opts?: unknown) => Promise<unknown>>(),
  createHold: vi.fn<() => Promise<{ holdId: string }>>(async () => ({ holdId: 'hold_x' })),
}));

vi.mock('@/lib/db/connect', () => ({ connectDB: h.connectDB }));

vi.mock('@/lib/db/models/groomer-profile', () => ({
  GroomerProfile: { findOne: h.profileFindOne },
}));

vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    paymentIntents: { create: h.piCreate, update: h.piUpdate },
  }),
}));

vi.mock('@/lib/db/models/pending-booking', () => ({
  PendingBooking: { findOneAndUpdate: h.pendingUpsert },
}));

vi.mock('@/lib/redis', () => ({
  isRedisConfigured: () => false,
}));

vi.mock('@/lib/calendar/holds', () => ({
  createHold: h.createHold,
  // Mirror the real shape (an Error subclass) so an `instanceof` check in the
  // subject would still behave; the no-hold path means it's never thrown here.
  SlotHeldError: class SlotHeldError extends Error {},
}));

// Import the subjects AFTER the mocks are registered.
import { handleAccountUpdated } from '@/app/api/webhooks/stripe/helpers';
import {
  createDepositPaymentIntent,
  type DepositMetadata,
} from '@/lib/stripe/helpers';

// ---------------------------------------------------------------------------
// Per-test controllable return for GroomerProfile.findOne.
// ---------------------------------------------------------------------------

/** The next value `GroomerProfile.findOne(...)` (awaited directly) resolves to. */
let findOneReturn: unknown = null;

/**
 * A mutable stub GroomerProfile "row" mimicking a Mongoose doc, with a `save()`
 * spy — used by the `handleAccountUpdated` tests.
 */
type MockProfileRow = {
  stripeConnectAccountId?: string;
  connectStatus?: ConnectStatus;
  stripeConnectChargesEnabled?: boolean;
  save: ReturnType<typeof vi.fn>;
};

function makeProfileRow(overrides: Partial<MockProfileRow> = {}): MockProfileRow {
  return {
    stripeConnectAccountId: 'acct_123',
    connectStatus: 'pending',
    stripeConnectChargesEnabled: false,
    save: vi.fn(async () => undefined),
    ...overrides,
  };
}

/**
 * Build the chainable query object the deposit helper expects from
 * `findOne(filter).select(fields).lean()` — `.select` returns `this`, `.lean`
 * resolves to the lean profile view (or `null`).
 */
function makeLeanQuery(leanResult: unknown) {
  const query = {
    select: vi.fn(() => query),
    lean: vi.fn(async () => leanResult),
  };
  return query;
}

/** A minimal valid Stripe.Account literal for the webhook handler. */
function fakeAccount(overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id: 'acct_123',
    charges_enabled: false,
    details_submitted: false,
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    ...overrides,
  } as unknown as Stripe.Account;
}

/** A full booking payload for the deposit helper. */
const BOOKING: DepositMetadata = {
  pet: { name: 'Rex' } as unknown as DepositMetadata['pet'],
  owner: { email: 'owner@example.com' } as unknown as DepositMetadata['owner'],
  slotStart: '2025-07-01T10:00:00.000Z',
  slotEnd: '2025-07-01T11:00:00.000Z',
};

const OLD_FEE = process.env.STRIPE_PLATFORM_FEE_PERCENT;

beforeEach(() => {
  vi.clearAllMocks();
  findOneReturn = null;
  // findOne returns the per-test value (awaited directly by the webhook handler;
  // the deposit helper substitutes a chainable query via findOneReturn itself).
  h.profileFindOne.mockImplementation(() => findOneReturn);
  h.piCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'cs_1' });
  h.piUpdate.mockResolvedValue({ id: 'pi_1' });
  h.pendingUpsert.mockResolvedValue({ bookingRef: 'PP-TEST01' });
  // Launch default: platform fee unset ⇒ 0 ⇒ application_fee_amount omitted.
  delete process.env.STRIPE_PLATFORM_FEE_PERCENT;
});

afterEach(() => {
  if (OLD_FEE === undefined) delete process.env.STRIPE_PLATFORM_FEE_PERCENT;
  else process.env.STRIPE_PLATFORM_FEE_PERCENT = OLD_FEE;
});

// ---------------------------------------------------------------------------
// handleAccountUpdated — idempotent Connect status sync (R15.4 / R15.5)
// ---------------------------------------------------------------------------
describe('handleAccountUpdated: idempotent Connect status sync (R15.4/15.5)', () => {
  it('maps charges_enabled=true → complete + chargesEnabled true, idempotent on re-delivery', async () => {
    const row = makeProfileRow({ connectStatus: 'pending', stripeConnectChargesEnabled: false });
    findOneReturn = row;

    await handleAccountUpdated(fakeAccount({ charges_enabled: true, details_submitted: true }));

    expect(row.connectStatus).toBe('complete');
    expect(row.stripeConnectChargesEnabled).toBe(true);
    expect(row.save).toHaveBeenCalledTimes(1);

    // Re-delivery (same event) converges to the same final state (idempotent).
    await handleAccountUpdated(fakeAccount({ charges_enabled: true, details_submitted: true }));

    expect(row.connectStatus).toBe('complete');
    expect(row.stripeConnectChargesEnabled).toBe(true);
    expect(row.save).toHaveBeenCalledTimes(2);
  });

  it('maps currently_due non-empty + charges_enabled=false → needs_info + chargesEnabled false', async () => {
    const row = makeProfileRow();
    findOneReturn = row;

    await handleAccountUpdated(
      fakeAccount({
        charges_enabled: false,
        requirements: {
          currently_due: ['x'],
          past_due: [],
          disabled_reason: null,
        } as unknown as Stripe.Account.Requirements,
      })
    );

    expect(row.connectStatus).toBe('needs_info');
    expect(row.stripeConnectChargesEnabled).toBe(false);
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  it('maps requirements.disabled_reason set → disabled', async () => {
    const row = makeProfileRow();
    findOneReturn = row;

    await handleAccountUpdated(
      fakeAccount({
        charges_enabled: false,
        requirements: {
          currently_due: [],
          past_due: [],
          disabled_reason: 'rejected.fraud',
        } as unknown as Stripe.Account.Requirements,
      })
    );

    expect(row.connectStatus).toBe('disabled');
    expect(row.stripeConnectChargesEnabled).toBe(false);
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  it('no-ops (no save, no throw) when no profile matches the account id', async () => {
    findOneReturn = null;

    await expect(
      handleAccountUpdated(fakeAccount({ charges_enabled: true }))
    ).resolves.toBeUndefined();

    // findOne was consulted but nothing was written.
    expect(h.profileFindOne).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createDepositPaymentIntent — deposit gate + direct charge (R16.1/16.2/17.1)
// ---------------------------------------------------------------------------
describe('createDepositPaymentIntent: Connect gate blocks when not complete (R16.1/17.1)', () => {
  it('returns { ok:false } with the CONNECT_NOT_READY message and does NOT charge or write PendingBooking', async () => {
    // Profile exists but Connect is NOT complete (pending) and no account id.
    findOneReturn = makeLeanQuery({
      userId: { toString: () => 'groomer_1' },
      depositAmount: 25,
      connectStatus: 'pending',
      stripeConnectAccountId: undefined,
      stripeConnectChargesEnabled: false,
    });

    const res = await createDepositPaymentIntent('slug', BOOKING);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("isn't able to accept online payments yet");
    }
    // The gate fires BEFORE any Stripe call or PendingBooking write.
    expect(h.piCreate).not.toHaveBeenCalled();
    expect(h.piUpdate).not.toHaveBeenCalled();
    expect(h.pendingUpsert).not.toHaveBeenCalled();
  });

  it('also blocks when connectStatus is complete but no stripeConnectAccountId is stored', async () => {
    findOneReturn = makeLeanQuery({
      userId: { toString: () => 'groomer_1' },
      depositAmount: 25,
      connectStatus: 'complete',
      stripeConnectAccountId: undefined,
      stripeConnectChargesEnabled: true,
    });

    const res = await createDepositPaymentIntent('slug', BOOKING);

    expect(res.ok).toBe(false);
    expect(h.piCreate).not.toHaveBeenCalled();
    expect(h.pendingUpsert).not.toHaveBeenCalled();
  });
});

describe('createDepositPaymentIntent: direct charge once Connect is complete (R16.2)', () => {
  it('creates the PI on the connected account with NO application_fee_amount at the 0% launch fee', async () => {
    findOneReturn = makeLeanQuery({
      userId: { toString: () => 'groomer_1' },
      depositAmount: 25,
      connectStatus: 'complete',
      stripeConnectAccountId: 'acct_123',
      stripeConnectChargesEnabled: true,
    });

    const res = await createDepositPaymentIntent('slug', BOOKING);

    expect(res.ok).toBe(true);

    // The PI was created exactly once, as a DIRECT CHARGE on the connected
    // account (second arg carries { stripeAccount: 'acct_123' }).
    expect(h.piCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = h.piCreate.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: 'acct_123' });

    // At the launch 0% fee the application_fee_amount key is OMITTED entirely
    // (Stripe rejects a 0 fee on a direct charge).
    expect(params).not.toHaveProperty('application_fee_amount');
    // Sanity: the direct charge carries the resolved amount in minor units.
    expect(params).toMatchObject({ amount: 2500, currency: 'usd' });

    // The follow-up metadata update also targets the connected account.
    expect(h.piUpdate).toHaveBeenCalledTimes(1);
    expect(h.piUpdate.mock.calls[0][2]).toEqual({ stripeAccount: 'acct_123' });

    // A PendingBooking was persisted (keyed by the PI id).
    expect(h.pendingUpsert).toHaveBeenCalledTimes(1);
  });
});
