/**
 * Route ranking only for orderRadar (plan-claims-audit, Property 3).
 *
 * Pure cores only: `shapeSlotsForPlan` strips route annotations and time-orders
 * slots when routing is not allowed; `resolveEntitlements` + `checkFeature`
 * decide whether routing is allowed. No DB, Redis or Mapbox.
 *
 * **Validates: Requirements 1.1, 1.2**
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { shapeSlotsForPlan } from '@/lib/calendar/slot-shaping';
import {
  checkFeature,
  resolveEntitlements,
  type SubscriptionInput,
} from '@/lib/billing/entitlements';
import { PLANS, type PlanName } from '@/lib/plans';
import type { SubscriptionStatus } from '@/lib/db/models/subscription';

const DAY_MS = 24 * 60 * 60 * 1000;

interface TestSlot {
  id: number;
  start: Date | string;
  end: Date | string;
  available: boolean;
  label?: string | null;
  extraDriveMin?: number;
}

const toMs = (v: Date | string) => (v instanceof Date ? v.getTime() : Date.parse(v));

/** A start in a narrow range so equal starts (ties) show up regularly. */
const startMsArb = fc.oneof(
  fc.integer({ min: 0, max: 20 }).map((n) => Date.parse('2025-06-15T08:00:00.000Z') + n * 15 * 60 * 1000),
  fc.integer({
    min: Date.parse('2024-01-01T00:00:00.000Z'),
    max: Date.parse('2027-01-01T00:00:00.000Z'),
  })
);

/** Render a timestamp as either a Date or an ISO string. */
const asDateOrIso = (ms: number) =>
  fc.constantFrom<'date' | 'iso'>('date', 'iso').map((k) => (k === 'date' ? new Date(ms) : new Date(ms).toISOString()));

const slotBodyArb = startMsArb.chain((startMs) =>
  fc.record(
    {
      start: asDateOrIso(startMs),
      end: asDateOrIso(startMs + 60 * 60 * 1000),
      available: fc.boolean(),
      label: fc.option(fc.constantFrom('Best fit', 'Near your route', 'Out of the way'), { nil: undefined }),
      extraDriveMin: fc.option(fc.integer({ min: 0, max: 120 }), { nil: undefined }),
    },
    { requiredKeys: ['start', 'end', 'available'] }
  )
);

/** An unordered slot list; each slot gets a unique id to track identity. */
const slotsArb: fc.Arbitrary<TestSlot[]> = fc
  .array(slotBodyArb, { maxLength: 30 })
  .map((bodies) => bodies.map((b, id) => ({ id, ...b }) as TestSlot));

/** Deep snapshot that keeps Date instances comparable. */
function snapshot(slots: TestSlot[]) {
  return slots.map((s) => ({ ...s, start: s.start instanceof Date ? new Date(s.start) : s.start, end: s.end instanceof Date ? new Date(s.end) : s.end }));
}

function assertPlainShape(input: TestSlot[], out: TestSlot[]) {
  expect(out).not.toBe(input);
  expect(out).toHaveLength(input.length);

  // Permutation of the input (by id).
  expect(out.map((s) => s.id).sort((a, b) => a - b)).toEqual(input.map((s) => s.id));

  // Sorted by start ascending.
  for (let i = 1; i < out.length; i++) {
    expect(toMs(out[i - 1].start)).toBeLessThanOrEqual(toMs(out[i].start));
  }

  const byId = new Map(input.map((s) => [s.id, s]));
  for (const s of out) {
    expect(s.label).toBeUndefined();
    expect(s.extraDriveMin).toBeUndefined();
    const orig = byId.get(s.id)!;
    expect(s.start).toEqual(orig.start);
    expect(s.end).toEqual(orig.end);
    expect(s.available).toBe(orig.available);
  }
}

// --- Subscriptions that must NOT get orderRadar ----------------------------

const STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'canceled', 'expired'];
const PLAN_NAMES: readonly PlanName[] = ['trial', 'solo', 'pro'];
const NOW = new Date('2025-06-15T12:00:00.000Z');

const dateFieldArb: fc.Arbitrary<Date | string | null> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: -60 * DAY_MS, max: 60 * DAY_MS }).map((o) => new Date(NOW.getTime() + o)),
  fc.integer({ min: -60 * DAY_MS, max: 60 * DAY_MS }).map((o) => new Date(NOW.getTime() + o).toISOString())
);

const anySubArb: fc.Arbitrary<SubscriptionInput> = fc.record({
  plan: fc.constantFrom(...PLAN_NAMES),
  status: fc.constantFrom(...STATUSES),
  smsIncluded: fc.integer({ min: 0, max: 5000 }),
  smsTopupBalance: fc.integer({ min: 0, max: 5000 }),
  foundingMember: fc.boolean(),
  trialEndsAt: dateFieldArb,
  currentPeriodEnd: dateFieldArb,
}) as fc.Arbitrary<SubscriptionInput>;

/** Solo rows of any status, plus rows of any plan that are canceled/expired. */
const soloOrInactiveSubArb: fc.Arbitrary<SubscriptionInput> = fc.oneof(
  anySubArb.map((s) => ({ ...s, plan: 'solo' as PlanName, smsIncluded: PLANS.solo.sms })),
  anySubArb.chain((s) => fc.constantFrom<SubscriptionStatus>('canceled', 'expired').map((status) => ({ ...s, status }))),
  // Elapsed trial.
  anySubArb.map((s) => ({ ...s, plan: 'trial' as PlanName, status: 'trialing' as SubscriptionStatus, trialEndsAt: new Date(NOW.getTime() - DAY_MS) }))
);

describe('Feature: plan-claims-audit, Property 3: Route ranking only for orderRadar', () => {
  it('routingAllowed: false → time-ordered permutation with no label/extraDriveMin, input not mutated', () => {
    fc.assert(
      fc.property(slotsArb, (input) => {
        const before = snapshot(input);
        const out = shapeSlotsForPlan(input, { routingAllowed: false });
        assertPlainShape(input, out);
        // Input array and objects untouched.
        expect(input).toEqual(before);
      }),
      { numRuns: 300 }
    );
  });

  it('routingAllowed: true → input returned unchanged', () => {
    fc.assert(
      fc.property(slotsArb, (input) => {
        const before = snapshot(input);
        const out = shapeSlotsForPlan(input, { routingAllowed: true });
        expect(out).toBe(input);
        expect(out).toEqual(before);
      }),
      { numRuns: 200 }
    );
  });

  it('Solo and inactive subscriptions never get orderRadar, so their slots are always plain', () => {
    fc.assert(
      fc.property(soloOrInactiveSubArb, slotsArb, (sub, input) => {
        const ent = resolveEntitlements(sub, NOW);
        const routingAllowed = checkFeature(ent, 'orderRadar') === null;
        expect(routingAllowed).toBe(false);
        assertPlainShape(input, shapeSlotsForPlan(input, { routingAllowed }));
      }),
      { numRuns: 200 }
    );
  });
});
