/**
 * Plan catalog + feature matrix (Master Spec §13.1).
 *
 * This is the SINGLE file to edit when plans, prices, SMS allowances, or the
 * per-plan feature set change. Everything else (entitlements, billing, gating,
 * the billing UI) reads from here so plan definitions never drift.
 *
 * Nothing in here touches Stripe, the DB, or Redis — it is a pure, static
 * catalog plus the pure {@link hasFeature} helper, so it is fully importable
 * from client components and unit tests without any configuration.
 *
 * _Master Spec: §13.1_
 */

/**
 * The exact feature keys used across the app (Master Spec §13.1). These are the
 * capability names passed to `assertFeature(groomerId, feature)` server-side
 * and to `hasFeature(plan, feature)` for UI hints.
 */
export const FEATURE_KEYS = [
  'booking',
  'deposits',
  'nativeCalendar',
  'petCards',
  'reminders',
  'waitlistBasic',
  'ics',
  'orderRadar',
  'smartSlots',
  'fillMyDay',
  'liveEta',
  'rebookAutopilot',
  'beforeAfter',
  'reviewRequests',
  'customTemplates',
  'optimizeDay',
] as const;

/** A single gated capability key. */
export type Feature = (typeof FEATURE_KEYS)[number];

/**
 * Feature set shared by Solo and Pro (the base grooming toolkit). Pro extends
 * this with the routing / automation "cherry" features.
 */
const SOLO_FEATURES = [
  'booking',
  'deposits',
  'nativeCalendar',
  'petCards',
  'reminders',
  'waitlistBasic',
  'ics',
] as const satisfies readonly Feature[];

/** Pro adds the hook features on top of the Solo base (Master Spec §11, §13.1). */
const PRO_FEATURES = [
  ...SOLO_FEATURES,
  'orderRadar',
  'smartSlots',
  'fillMyDay',
  'liveEta',
  'rebookAutopilot',
  'beforeAfter',
  'reviewRequests',
  'customTemplates',
  'optimizeDay',
] as const satisfies readonly Feature[];

/**
 * Plan definitions (Master Spec §13.1). `trial` is a 14-day view of Pro that
 * requires no card; `solo` and `pro` are the paid tiers with monthly/annual
 * prices (annual ≈ 2 months free) and their included monthly SMS allowance.
 */
export const PLANS = {
  trial: { price: 0, days: 14, tier: 'pro', sms: 300 },
  solo: {
    priceMonth: 29,
    priceYear: 290,
    sms: 300,
    features: SOLO_FEATURES,
  },
  pro: {
    priceMonth: 59,
    priceYear: 590,
    sms: 800,
    features: PRO_FEATURES,
  },
} as const;

/** One-time SMS top-up bundle (Master Spec §13.1). */
export const SMS_TOPUP = { messages: 500, price: 9 } as const;

/**
 * Founding-member program (Master Spec §13.1, §13.2): a limited number of
 * lifetime-locked discounted seats.
 */
export const FOUNDING = {
  spots: 20,
  soloMonth: 19,
  proMonth: 39,
  lockedForLife: true,
} as const;

/**
 * A billable plan key. `trial` is not a billable plan (it maps to the `pro`
 * tier for capabilities) — see {@link PlanTier} for the entitlement tier.
 */
export type PlanName = keyof typeof PLANS;

/**
 * The capability TIER a plan grants. `trial` resolves to `pro` capabilities,
 * so the resolvable tiers are the paid tiers only.
 */
export type PlanTier = 'solo' | 'pro';

/** Billing intervals offered at checkout. */
export type BillingInterval = 'month' | 'year';

/**
 * The feature list granted by a given TIER. `trial` is intentionally excluded
 * here because it is expressed as the `pro` tier at resolution time.
 */
const TIER_FEATURES: Record<PlanTier, readonly Feature[]> = {
  solo: PLANS.solo.features,
  pro: PLANS.pro.features,
};

/**
 * Whether a plan/tier grants a feature (Master Spec §13.1). PURE — no DB, no
 * Redis, no Stripe. Accepts either a {@link PlanTier} (`"solo" | "pro"`) or the
 * `"trial"` plan name (treated as `pro`), so callers can pass whatever they
 * have without normalizing first.
 *
 * @param plan  The capability tier or the `"trial"` plan name.
 * @param feature The capability key to check.
 * @returns `true` when the plan grants the feature.
 */
export function hasFeature(plan: PlanTier | 'trial', feature: Feature): boolean {
  const tier: PlanTier = plan === 'trial' ? PLANS.trial.tier : plan;
  return TIER_FEATURES[tier].includes(feature);
}

/**
 * The included monthly SMS allowance for a plan name (Master Spec §13.1). Used
 * as the default allowance when a Subscription row does not carry an explicit
 * `smsIncluded`.
 */
export function smsAllowanceFor(plan: PlanName): number {
  return PLANS[plan].sms;
}
