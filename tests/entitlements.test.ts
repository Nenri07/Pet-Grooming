/**
 * Entitlement gating unit tests (Master Spec §0 rule 3 — entitlement gating
 * tests allowed; §13.1, §13.2).
 *
 * These exercise ONLY the pure cores — no DB, no Redis, no Stripe:
 *   - hasFeature: the plan/tier → feature matrix (§13.1).
 *   - resolveEntitlements: the §13.2 lifecycle state machine (trialing → active
 *     → past_due grace → canceled/expired), including the default fresh-trial
 *     view when there is no subscription row, and founding-member flags.
 *   - checkFeature: the gate decision assertFeature is built on.
 */
import { describe, expect, it } from 'vitest';
import { hasFeature, PLANS, type Feature } from '@/lib/plans';
import {
  resolveEntitlements,
  checkFeature,
  defaultTrialSubscription,
  FeatureLockedError,
  GRACE_PERIOD_DAYS,
  type SubscriptionInput,
} from '@/lib/billing/entitlements';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2025-06-15T12:00:00.000Z');

/** Build a subscription input with sensible defaults for a test. */
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

// ---------------------------------------------------------------------------
// hasFeature — the plan/tier feature matrix (§13.1)
// ---------------------------------------------------------------------------
describe('hasFeature', () => {
  it('grants the shared base features to Solo', () => {
    for (const f of PLANS.solo.features) {
      expect(hasFeature('solo', f)).toBe(true);
    }
  });

  it('denies Pro-only features to Solo', () => {
    const proOnly: Feature[] = [
      'orderRadar',
      'smartSlots',
      'fillMyDay',
      'liveEta',
      'rebookAutopilot',
      'beforeAfter',
      'reviewRequests',
      'customTemplates',
      'optimizeDay',
    ];
    for (const f of proOnly) {
      expect(hasFeature('solo', f)).toBe(false);
    }
  });

  it('grants every feature to Pro', () => {
    for (const f of PLANS.pro.features) {
      expect(hasFeature('pro', f)).toBe(true);
    }
    expect(hasFeature('pro', 'orderRadar')).toBe(true);
    expect(hasFeature('pro', 'fillMyDay')).toBe(true);
  });

  it('treats the trial plan name as Pro capabilities', () => {
    expect(hasFeature('trial', 'orderRadar')).toBe(true);
    expect(hasFeature('trial', 'optimizeDay')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveEntitlements — the §13.2 state machine
// ---------------------------------------------------------------------------
describe('resolveEntitlements', () => {
  it('defaults a missing subscription to a fresh 14-day Pro trial', () => {
    const ent = resolveEntitlements(null, NOW);
    expect(ent.plan).toBe('trial');
    expect(ent.tier).toBe('pro');
    expect(ent.status).toBe('trialing');
    expect(ent.active).toBe(true);
    // Trial grants Pro features.
    expect(ent.features).toContain('orderRadar');
    expect(ent.features).toContain('fillMyDay');
    // Trial ends ~14 days out.
    const days = Math.round(
      (Date.parse(ent.trialEndsAt!) - NOW.getTime()) / DAY
    );
    expect(days).toBe(PLANS.trial.days);
  });

  it('grants Pro features while trialing before the trial ends', () => {
    const ent = resolveEntitlements(
      sub({ plan: 'trial', status: 'trialing', trialEndsAt: new Date(NOW.getTime() + 3 * DAY) }),
      NOW
    );
    expect(ent.active).toBe(true);
    expect(ent.features).toContain('orderRadar');
  });

  it('expires (read-only) once the trial has elapsed', () => {
    const ent = resolveEntitlements(
      sub({ plan: 'trial', status: 'trialing', trialEndsAt: new Date(NOW.getTime() - 1 * DAY) }),
      NOW
    );
    expect(ent.active).toBe(false);
    expect(ent.status).toBe('expired');
    expect(ent.features).toEqual([]);
  });

  it('grants a Solo subscription the Solo features but not Pro ones', () => {
    const ent = resolveEntitlements(sub({ plan: 'solo', status: 'active' }), NOW);
    expect(ent.active).toBe(true);
    expect(ent.tier).toBe('solo');
    expect(ent.features).toContain('booking');
    expect(ent.features).toContain('deposits');
    expect(ent.features).not.toContain('orderRadar');
    expect(ent.features).not.toContain('fillMyDay');
  });

  it('grants an active Pro subscription every feature', () => {
    const ent = resolveEntitlements(sub({ plan: 'pro', status: 'active' }), NOW);
    expect(ent.features).toContain('orderRadar');
    expect(ent.features).toContain('optimizeDay');
  });

  it('keeps past_due active while inside the 7-day grace window', () => {
    const ent = resolveEntitlements(
      sub({
        plan: 'pro',
        status: 'past_due',
        currentPeriodEnd: new Date(NOW.getTime() - 2 * DAY),
      }),
      NOW
    );
    expect(ent.active).toBe(true);
    expect(ent.inGracePeriod).toBe(true);
    expect(ent.features).toContain('orderRadar');
  });

  it('locks past_due to read-only once the grace window elapses', () => {
    const ent = resolveEntitlements(
      sub({
        plan: 'pro',
        status: 'past_due',
        currentPeriodEnd: new Date(NOW.getTime() - (GRACE_PERIOD_DAYS + 1) * DAY),
      }),
      NOW
    );
    expect(ent.active).toBe(false);
    expect(ent.inGracePeriod).toBe(false);
    expect(ent.features).toEqual([]);
  });

  it('treats canceled and expired as read-only (no features)', () => {
    for (const status of ['canceled', 'expired'] as const) {
      const ent = resolveEntitlements(sub({ plan: 'pro', status }), NOW);
      expect(ent.active).toBe(false);
      expect(ent.features).toEqual([]);
    }
  });

  it('surfaces the founding-member flag and SMS balances', () => {
    const ent = resolveEntitlements(
      sub({ plan: 'pro', status: 'active', foundingMember: true, smsTopupBalance: 120 }),
      NOW
    );
    expect(ent.foundingMember).toBe(true);
    expect(ent.smsIncluded).toBe(PLANS.pro.sms);
    expect(ent.smsTopupBalance).toBe(120);
  });

  it('uses the default trial when no row exists (defaultTrialSubscription)', () => {
    const trial = defaultTrialSubscription(NOW);
    expect(trial.plan).toBe('trial');
    expect(trial.status).toBe('trialing');
    expect(trial.smsIncluded).toBe(PLANS.trial.sms);
  });
});

// ---------------------------------------------------------------------------
// checkFeature — the gate assertFeature is built on
// ---------------------------------------------------------------------------
describe('checkFeature (assertFeature core)', () => {
  it('allows a granted feature on an active plan', () => {
    const ent = resolveEntitlements(sub({ plan: 'pro', status: 'active' }), NOW);
    expect(checkFeature(ent, 'orderRadar')).toBeNull();
  });

  it('locks a Pro feature for a Solo plan with a plan-gap error', () => {
    const ent = resolveEntitlements(sub({ plan: 'solo', status: 'active' }), NOW);
    const err = checkFeature(ent, 'orderRadar');
    expect(err).toBeInstanceOf(FeatureLockedError);
    expect(err?.inactive).toBe(false);
    expect(err?.statusCode).toBe(403);
    expect(err?.code).toBe('FEATURE_LOCKED');
  });

  it('locks every feature when the subscription is inactive', () => {
    const ent = resolveEntitlements(sub({ plan: 'pro', status: 'canceled' }), NOW);
    // Even a base feature is locked when read-only.
    const err = checkFeature(ent, 'booking');
    expect(err).toBeInstanceOf(FeatureLockedError);
    expect(err?.inactive).toBe(true);
    expect(err?.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('allows Pro features during the trial', () => {
    const ent = resolveEntitlements(null, NOW); // fresh trial
    expect(checkFeature(ent, 'fillMyDay')).toBeNull();
  });
});
