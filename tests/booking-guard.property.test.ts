/**
 * Booking guard property tests (plan-claims-audit, Property 2).
 *
 * Pure cores only: `resolveEntitlements` turns a subscription row (or `null`)
 * into an entitlement view, and `acceptsBookings` decides whether that view may
 * take new online bookings. No DB, Redis or payment provider.
 *
 * **Validates: Requirements 2.1, 2.2, 2.4**
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { acceptsBookings } from '@/lib/billing/booking-guard';
import {
  GRACE_PERIOD_DAYS,
  resolveEntitlements,
  type SubscriptionInput,
} from '@/lib/billing/entitlements';
import { PLANS, type PlanName } from '@/lib/plans';
import type { SubscriptionStatus } from '@/lib/db/models/subscription';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = GRACE_PERIOD_DAYS * DAY_MS;
const NOW = new Date('2025-06-15T12:00:00.000Z');

const STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
];
const PLAN_NAMES: readonly PlanName[] = ['trial', 'solo', 'pro'];

/** Build a subscription input with sensible defaults. */
function sub(overrides: Partial<SubscriptionInput>): SubscriptionInput {
  return {
    plan: 'pro',
    status: 'active',
    smsIncluded: PLANS.pro.sms,
    smsTopupBalance: 0,
    foundingMember: false,
    trialEndsAt: null,
    currentPeriodEnd: null,
    ...overrides,
  };
}

/**
 * Offsets (ms, relative to `now`) that cluster around the interesting
 * boundaries: now itself and the grace edge, plus a wide random spread.
 */
const offsetArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: -40 * DAY_MS, max: 40 * DAY_MS }),
  fc.constantFrom(0, -1, 1, -GRACE_MS, -GRACE_MS + 1, -GRACE_MS - 1),
  fc
    .integer({ min: -5 * 60 * 1000, max: 5 * 60 * 1000 })
    .map((jitter) => -GRACE_MS + jitter)
);

/** A date field relative to `now`: null, a Date, or an ISO string. */
function dateFieldArb(nowMs: number): fc.Arbitrary<Date | string | null> {
  return fc.oneof(
    fc.constant(null),
    offsetArb.map((o) => new Date(nowMs + o)),
    offsetArb.map((o) => new Date(nowMs + o).toISOString())
  );
}

const nowArb = fc
  .integer({
    min: Date.parse('2020-01-01T00:00:00.000Z'),
    max: Date.parse('2035-01-01T00:00:00.000Z'),
  })
  .map((ms) => new Date(ms));

/** A `now` plus a subscription input (or null = no row) built around it. */
const scenarioArb = nowArb.chain((now) =>
  fc.record({
    now: fc.constant(now),
    sub: fc.option(
      fc.record({
        plan: fc.constantFrom(...PLAN_NAMES),
        status: fc.constantFrom(...STATUSES),
        smsIncluded: fc.integer({ min: 0, max: 5000 }),
        smsTopupBalance: fc.integer({ min: 0, max: 5000 }),
        foundingMember: fc.boolean(),
        trialEndsAt: dateFieldArb(now.getTime()),
        currentPeriodEnd: dateFieldArb(now.getTime()),
      }) as fc.Arbitrary<SubscriptionInput>,
      { nil: null, freq: 10 }
    ),
  })
);

/** Independent oracle for "this row is lapsed" (design Property 2). */
function isLapsed(s: SubscriptionInput, now: Date): boolean {
  const nowMs = now.getTime();
  const ms = (v: Date | string | null | undefined) =>
    v == null ? null : new Date(v).getTime();
  const trialEnd = ms(s.trialEndsAt);
  const periodEnd = ms(s.currentPeriodEnd);
  switch (s.status) {
    case 'trialing':
      return trialEnd != null && nowMs >= trialEnd;
    case 'active':
      return periodEnd != null && nowMs >= periodEnd + GRACE_MS;
    case 'past_due':
      return periodEnd != null && nowMs >= periodEnd + GRACE_MS;
    case 'canceled':
    case 'expired':
    default:
      return true;
  }
}

describe('Feature: plan-claims-audit, Property 2: Lapsed accounts never accept bookings', () => {
  it('acceptsBookings always equals the resolved view.active', () => {
    fc.assert(
      fc.property(scenarioArb, ({ sub: s, now }) => {
        const ent = resolveEntitlements(s, now);
        expect(acceptsBookings(ent)).toBe(ent.active);
      }),
      { numRuns: 300 }
    );
  });

  it('a lapsed row never accepts bookings, and a usable row always does', () => {
    fc.assert(
      fc.property(scenarioArb, ({ sub: s, now }) => {
        const ent = resolveEntitlements(s, now);
        // No row → fresh trial → accepts bookings.
        const lapsed = s == null ? false : isLapsed(s, now);
        expect(acceptsBookings(ent)).toBe(!lapsed);
      }),
      { numRuns: 300 }
    );
  });

  describe('concrete lapsed cases are rejected', () => {
    const cases: Array<[string, SubscriptionInput]> = [
      [
        'expired trial',
        sub({ plan: 'trial', status: 'trialing', trialEndsAt: new Date(NOW.getTime() - DAY_MS) }),
      ],
      [
        'trial ending exactly now',
        sub({ plan: 'trial', status: 'trialing', trialEndsAt: NOW }),
      ],
      ['canceled', sub({ status: 'canceled', currentPeriodEnd: new Date(NOW.getTime() + DAY_MS) })],
      ['expired', sub({ status: 'expired' })],
      [
        'past_due more than 7 days after currentPeriodEnd',
        sub({ status: 'past_due', currentPeriodEnd: new Date(NOW.getTime() - GRACE_MS - DAY_MS) }),
      ],
      [
        'past_due exactly 7 days after currentPeriodEnd',
        sub({ status: 'past_due', currentPeriodEnd: new Date(NOW.getTime() - GRACE_MS) }),
      ],
      [
        'active with currentPeriodEnd exactly 7 days ago (missed webhook)',
        sub({ status: 'active', currentPeriodEnd: new Date(NOW.getTime() - GRACE_MS) }),
      ],
      [
        'active solo with currentPeriodEnd 30 days ago (missed webhook)',
        sub({ plan: 'solo', status: 'active', currentPeriodEnd: new Date(NOW.getTime() - 30 * DAY_MS) }),
      ],
    ];
    it.each(cases)('%s', (_label, s) => {
      expect(acceptsBookings(resolveEntitlements(s, NOW))).toBe(false);
    });
  });

  describe('concrete usable cases are accepted', () => {
    const cases: Array<[string, SubscriptionInput | null]> = [
      ['no subscription row (fresh trial)', null],
      [
        'active trial',
        sub({ plan: 'trial', status: 'trialing', trialEndsAt: new Date(NOW.getTime() + 3 * DAY_MS) }),
      ],
      [
        'active Pro with a future period end',
        sub({ status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY_MS) }),
      ],
      [
        'active with currentPeriodEnd just under 7 days ago',
        sub({ status: 'active', currentPeriodEnd: new Date(NOW.getTime() - GRACE_MS + 1) }),
      ],
      [
        'past_due inside grace',
        sub({ status: 'past_due', currentPeriodEnd: new Date(NOW.getTime() - 2 * DAY_MS) }),
      ],
    ];
    it.each(cases)('%s', (_label, s) => {
      expect(acceptsBookings(resolveEntitlements(s, NOW))).toBe(true);
    });
  });
});
