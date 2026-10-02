import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { mapStripeSubStatus } from '@/app/api/webhooks/stripe/helpers';
import type { SubscriptionStatus } from '@/lib/db/models/subscription';

/**
 * The full set of local {@link SubscriptionStatus} values. `mapStripeSubStatus`
 * is TOTAL: every input string must land on one of these.
 */
const LOCAL_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
] as const;

const LOCAL_STATUS_SET: ReadonlySet<string> = new Set(LOCAL_STATUSES);

/**
 * The documented Stripe subscription statuses the mapper recognises explicitly,
 * mixed with the random strings below so the generator exercises both the known
 * branches and arbitrary/unknown input (future Stripe statuses, junk, '').
 */
const KNOWN_STRIPE_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'canceled',
  'paused',
] as const;

// Note (effect-path intent): at the webhook-handler level,
// `invoice.payment_failed` drives the local status -> `past_due` and
// `invoice.paid` drives it -> `active`. Those handlers are task 4.4; here we
// only unit-test the PURE status mapper, which backs those transitions via the
// `past_due`/`active` Stripe subscription statuses asserted below.

// Generator: known Stripe statuses, hand-picked junk, and arbitrary strings.
const stripeStatusArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...KNOWN_STRIPE_STATUSES),
  fc.constantFrom('frobnicate', '', 'ACTIVE', 'Active', 'past-due', 'none'),
  fc.string()
);

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 11: subscription-status
// mapping is total
//
// For ANY input string (known Stripe statuses, junk, or arbitrary strings),
// mapStripeSubStatus(s) returns a value that is a member of the local enum set
// {trialing, active, past_due, canceled, expired}.
//
// Validates: Requirements 5.2, 5.3, 5.4
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 11: subscription-status mapping is total', () => {
  it('maps every string into the local SubscriptionStatus enum', () => {
    fc.assert(
      fc.property(stripeStatusArb, (s) => {
        expect(LOCAL_STATUS_SET.has(mapStripeSubStatus(s))).toBe(true);
      }),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 11: targeted effect-path
// assertions
//
// Concrete anchor cases, one per documented branch of the mapper, including the
// unpaid/incomplete -> past_due, incomplete_expired -> expired, paused ->
// canceled, and the safe `expired` default for unknown input.
//
// Validates: Requirements 5.2, 5.3, 5.4
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 11: effect-path examples', () => {
  it("maps 'active' -> 'active'", () => {
    expect(mapStripeSubStatus('active')).toBe('active');
  });

  it("maps 'trialing' -> 'trialing'", () => {
    expect(mapStripeSubStatus('trialing')).toBe('trialing');
  });

  it("maps 'past_due' -> 'past_due'", () => {
    expect(mapStripeSubStatus('past_due')).toBe('past_due');
  });

  it("maps 'unpaid' -> 'past_due'", () => {
    expect(mapStripeSubStatus('unpaid')).toBe('past_due');
  });

  it("maps 'incomplete' -> 'past_due' (documents the impl)", () => {
    expect(mapStripeSubStatus('incomplete')).toBe('past_due');
  });

  it("maps 'incomplete_expired' -> 'expired'", () => {
    expect(mapStripeSubStatus('incomplete_expired')).toBe('expired');
  });

  it("maps 'canceled' -> 'canceled'", () => {
    expect(mapStripeSubStatus('canceled')).toBe('canceled');
  });

  it("maps 'paused' -> 'canceled'", () => {
    expect(mapStripeSubStatus('paused')).toBe('canceled');
  });

  it("maps unknown strings -> 'expired' (safe default)", () => {
    expect(mapStripeSubStatus('frobnicate')).toBe('expired');
    expect(mapStripeSubStatus('')).toBe('expired');
  });
});
