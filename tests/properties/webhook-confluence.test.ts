/**
 * Feature: billing-trial-and-payments, Property 12 — subscription lifecycle
 * idempotence / confluence.
 *
 * The real IMPURE handlers (`handleSubscriptionChange`, `handleInvoicePaid`,
 * `handleInvoicePaymentFailed`) each perform a STATE-SET (never an increment)
 * on the single local Subscription row. Stripe may redeliver any event, so the
 * router's authoritative guarantee is CONFLUENCE: processing a sequence of
 * lifecycle events that contains ARBITRARY DUPLICATES must converge to the same
 * final local state as processing the duplicate-free sequence (duplicates
 * collapsed, order preserved).
 *
 * We assert this on the observable final state the entitlements/lockout layer
 * reads: the row's `status` and whether the grace anchor `pastDueSince` is set
 * (null-ness).
 *
 * HERMETIC: the DB + Redis + cache seams the handlers touch are mocked. We
 * drive the REAL handlers against a shared in-memory stub row whose
 * `Subscription.findOne` returns it, so this exercises the actual production
 * transition logic (not a re-modelled copy).
 *
 * Validates: Requirements 5.6, 6.1, 6.2, 6.3
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type Stripe from 'stripe';

// --- Seams the handlers import (hoisted above the subject import). ----------
vi.mock('@/lib/db/connect', () => ({
  connectDB: vi.fn(async () => undefined),
}));
vi.mock('@/lib/billing/entitlements', () => ({
  invalidateEntitlements: vi.fn(async () => undefined),
}));

// Shared, swappable row returned by Subscription.findOne.
type Row = {
  groomerId: unknown;
  status: string;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  save: () => Promise<void>;
};
let currentRow: Row | null = null;
vi.mock('@/lib/db/models/subscription', () => ({
  Subscription: { findOne: vi.fn(async () => currentRow) },
}));

import {
  handleSubscriptionChange,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '@/app/api/webhooks/stripe/helpers';

// --- Lifecycle event model for the generator. ------------------------------
//
// A fixed set of lifecycle events, each a thunk that applies the matching REAL
// handler to the shared `currentRow`. Each event carries its own `now` so the
// grace-anchor timing is deterministic and order-sensitive where it matters.
type Kind = 'created' | 'updated_active' | 'payment_failed' | 'paid' | 'canceled';

const T0 = Date.parse('2025-06-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function subEvent(status: string): Stripe.Subscription {
  return {
    id: 'sub_123',
    customer: 'cus_123',
    status,
    items: { data: [] },
  } as unknown as Stripe.Subscription;
}
function invoiceEvent(): Stripe.Invoice {
  return {
    customer: 'cus_123',
    parent: { subscription_details: { subscription: 'sub_123' } },
    lines: { data: [] },
  } as unknown as Stripe.Invoice;
}

/**
 * Apply a lifecycle event (by kind + a deterministic `now`) to the shared row
 * via the real handler. `now` is derived from the event's position so repeated
 * payment_failed events at later times still must not move an already-set
 * anchor (idempotent SET semantics).
 */
async function apply(kind: Kind, now: Date): Promise<void> {
  switch (kind) {
    case 'created':
      await handleSubscriptionChange(subEvent('trialing'), now);
      break;
    case 'updated_active':
      await handleSubscriptionChange(subEvent('active'), now);
      break;
    case 'canceled':
      await handleSubscriptionChange(subEvent('canceled'), now);
      break;
    case 'payment_failed':
      await handleInvoicePaymentFailed(invoiceEvent(), now);
      break;
    case 'paid':
      await handleInvoicePaid(invoiceEvent());
      break;
  }
}

function freshRow(): Row {
  return {
    groomerId: 'groomer_1',
    status: 'trialing',
    currentPeriodEnd: null,
    pastDueSince: null,
    stripeSubscriptionId: 'sub_123',
    stripeCustomerId: 'cus_123',
    save: async () => undefined,
  };
}

/** Observable final state the lockout/entitlements layer reads. */
function observe(row: Row): { status: string; pastDue: boolean } {
  return { status: row.status, pastDue: row.pastDueSince != null };
}

/**
 * Collapse CONSECUTIVE/REPEATED deliveries of the same event id. Stripe
 * redelivery is a duplicate of a *specific* event; the duplicate-free sequence
 * removes repeats of the same kind that are adjacent after we tag each unique
 * event with an id. Here each distinct position in the base sequence is a
 * unique event; a "duplicate" is a re-delivery of that exact event, so the
 * duplicate-free run is simply the base sequence (each unique event once, in
 * order).
 */
async function runSequence(events: { kind: Kind; now: Date }[]): Promise<{ status: string; pastDue: boolean }> {
  currentRow = freshRow();
  for (const e of events) {
    await apply(e.kind, e.now);
  }
  return observe(currentRow);
}

beforeEach(() => {
  vi.clearAllMocks();
  currentRow = null;
});

const kindArb: fc.Arbitrary<Kind> = fc.constantFrom(
  'created',
  'updated_active',
  'payment_failed',
  'paid',
  'canceled'
);

describe('Feature: billing-trial-and-payments, Property 12: lifecycle idempotence/confluence', () => {
  it('a sequence with arbitrary duplicates converges to the duplicate-free final state', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A base sequence of unique events (each gets a monotonically advancing
        // `now`), plus, for each, how many extra duplicate re-deliveries to
        // insert immediately after it.
        fc.array(
          fc.record({ kind: kindArb, dups: fc.integer({ min: 0, max: 3 }) }),
          { minLength: 1, maxLength: 12 }
        ),
        async (base) => {
          // Build the duplicate-free sequence: one event per base entry, with a
          // strictly increasing timestamp so grace timing is well defined.
          const unique: { kind: Kind; now: Date }[] = base.map((e, i) => ({
            kind: e.kind,
            now: new Date(T0 + i * DAY),
          }));

          // Build the duplicated sequence: the same events in the same order,
          // but each immediately re-delivered `dups` extra times AT THE SAME
          // timestamp (a true redelivery of that event id).
          const duplicated: { kind: Kind; now: Date }[] = [];
          base.forEach((e, i) => {
            const now = new Date(T0 + i * DAY);
            duplicated.push({ kind: e.kind, now });
            for (let d = 0; d < e.dups; d++) {
              duplicated.push({ kind: e.kind, now });
            }
          });

          const finalUnique = await runSequence(unique);
          const finalDuplicated = await runSequence(duplicated);

          expect(finalDuplicated).toEqual(finalUnique);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('example: created → failed → failed(dup) → paid converges regardless of the duplicate', async () => {
    const seq: { kind: Kind; now: Date }[] = [
      { kind: 'created', now: new Date(T0) },
      { kind: 'payment_failed', now: new Date(T0 + DAY) },
      { kind: 'paid', now: new Date(T0 + 2 * DAY) },
    ];
    const withDup: { kind: Kind; now: Date }[] = [
      { kind: 'created', now: new Date(T0) },
      { kind: 'payment_failed', now: new Date(T0 + DAY) },
      { kind: 'payment_failed', now: new Date(T0 + DAY) }, // redelivery
      { kind: 'paid', now: new Date(T0 + 2 * DAY) },
    ];
    expect(await runSequence(withDup)).toEqual(await runSequence(seq));
    // And the terminal state is the expected active/no-grace one.
    expect(await runSequence(seq)).toEqual({ status: 'active', pastDue: false });
  });
});
