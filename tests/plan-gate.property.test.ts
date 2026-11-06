/**
 * Plan gate matrix property tests (plan-claims-audit, Property 1).
 *
 * Pure cores only: `resolveEntitlements` turns a subscription row (or `null`)
 * into an entitlement view, and `checkFeature` decides whether that view may
 * use a feature. No DB, Redis or payment provider.
 *
 * **Validates: Requirements 1.4, 1.5**
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  GRACE_PERIOD_DAYS,
  checkFeature,
  resolveEntitlements,
  type SubscriptionInput,
} from '@/lib/billing/entitlements';
import { PLANS, type Feature, type PlanName } from '@/lib/plans';
import type { SubscriptionStatus } from '@/lib/db/models/subscription';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = GRACE_PERIOD_DAYS * DAY_MS;
const NOW = new Date('2025-06-15T12:00:00.000Z');

/** Pro features named in the plan copy. */
const ADVERTISED_PRO_FEATURES = [
  'orderRadar',
  'fillMyDay',
  'liveEta',
  'rebookAutopilot',
  'beforeAfter',
] as const satisfies readonly Feature[];

/** Solo base features named in the plan copy. */
const SOLO_BASE_FEATURES = [
  'booking',
  'deposits',
  'nativeCalendar',
  'petCards',
  'reminders',
  'ics',
] as const satisfies readonly Feature[];

const STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
];
const PLAN_NAMES: readonly PlanName[] = ['trial', 'solo', 'pro'];

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

const proFeatureArb = fc.constantFrom(...ADVERTISED_PRO_FEATURES);

/** Independent oracle: is this row usable right now? (No row = fresh trial.) */
function isUsable(s: SubscriptionInput | null, now: Date): boolean {
  if (s == null) return true;
  const nowMs = now.getTime();
  const ms = (v: Date | string | null | undefined) =>
    v == null ? null : new Date(v).getTime();
  const trialEnd = ms(s.trialEndsAt);
  const periodEnd = ms(s.currentPeriodEnd);
  switch (s.status) {
    case 'trialing':
      return trialEnd == null || nowMs < trialEnd;
    case 'active':
    case 'past_due':
      return periodEnd == null || nowMs < periodEnd + GRACE_MS;
    default:
      return false;
  }
}

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

describe('Feature: plan-claims-audit, Property 1: Plan gate matrix', () => {
  it('advertised Pro features: allowed exactly for active Pro/trial, FEATURE_LOCKED for active Solo, SUBSCRIPTION_INACTIVE when inactive', () => {
    fc.assert(
      fc.property(scenarioArb, proFeatureArb, ({ sub: s, now }, f) => {
        const ent = resolveEntitlements(s, now);
        const denied = checkFeature(ent, f);

        // The resolved view's active flag matches the independent oracle.
        expect(ent.active).toBe(isUsable(s, now));

        if (!ent.active) {
          expect(denied).not.toBeNull();
          expect(denied!.code).toBe('SUBSCRIPTION_INACTIVE');
          expect(denied!.inactive).toBe(true);
          expect(denied!.feature).toBe(f);
          return;
        }

        if (ent.plan === 'solo') {
          expect(denied).not.toBeNull();
          expect(denied!.code).toBe('FEATURE_LOCKED');
          expect(denied!.inactive).toBe(false);
          expect(denied!.feature).toBe(f);
        } else {
          // Active Pro or trial view.
          expect(['pro', 'trial']).toContain(ent.plan);
          expect(denied).toBeNull();
        }
      }),
      { numRuns: 300 }
    );
  });

  it('every Solo base feature is allowed for any active view', () => {
    const baseArb = fc.constantFrom(...SOLO_BASE_FEATURES);
    fc.assert(
      fc.property(scenarioArb, baseArb, ({ sub: s, now }, f) => {
        const ent = resolveEntitlements(s, now);
        fc.pre(ent.active);
        expect(checkFeature(ent, f)).toBeNull();
      }),
      { numRuns: 200 }
    );
  });

  it('every Solo base feature is allowed for an active Solo subscription', () => {
    const ent = resolveEntitlements(
      sub({
        plan: 'solo',
        smsIncluded: PLANS.solo.sms,
        currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY_MS),
      }),
      NOW
    );
    expect(ent.active).toBe(true);
    for (const f of SOLO_BASE_FEATURES) {
      expect(checkFeature(ent, f)).toBeNull();
    }
  });

  it('each advertised Pro feature is in the Pro catalog and not in Solo', () => {
    const pro: readonly Feature[] = PLANS.pro.features;
    const solo: readonly Feature[] = PLANS.solo.features;
    for (const f of ADVERTISED_PRO_FEATURES) {
      expect(pro).toContain(f);
      expect(solo).not.toContain(f);
    }
  });
});
