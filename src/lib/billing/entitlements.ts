/**
 * Entitlement resolution + server-side feature gating (Master Spec §13.1, §13.2).
 *
 * This module answers two questions:
 *   1. "What can this groomer do right now?" — {@link getEntitlements}, resolved
 *      from their {@link Subscription} row, cached in Redis (`ent:{gid}`, 60s).
 *   2. "May this groomer use feature X?" — {@link assertFeature}, which throws a
 *      typed {@link FeatureLockedError} (mapped to 403 by route handlers) when
 *      the resolved plan lacks the feature or the subscription is inactive.
 *
 * The heart of it is {@link resolveEntitlements}, a PURE function that maps a
 * subscription (or `null`) + the current time to a full entitlement view. It
 * has no DB / Redis / Stripe dependency and encodes the §13.2 state machine:
 *
 *   trialing  → Pro capabilities until `trialEndsAt`; after that, expired.
 *   active    → the plan's own capabilities.
 *   past_due  → 7-day grace from `currentPeriodEnd`; everything still works
 *               (inGracePeriod=true); after the grace window, read-only.
 *   canceled  → read-only (no features).
 *   expired   → read-only (no features).
 *
 * A groomer with NO subscription row is treated as a fresh 14-day Pro trial
 * (§13.2 default), so new sign-ups get the full Pro experience immediately.
 *
 * _Master Spec: §13.1, §13.2, §15_
 */
import { AppError } from '@/lib/errors';
import {
  FEATURE_KEYS,
  PLANS,
  hasFeature,
  type Feature,
  type PlanName,
  type PlanTier,
} from '@/lib/plans';
import type { ISubscription, SubscriptionStatus } from '@/lib/db/models/subscription';

/** The 7-day grace window for `past_due` subscriptions (Master Spec §13.2). */
export const GRACE_PERIOD_DAYS = 7;
/** Default trial length in days (Master Spec §13.1, §13.2). */
export const TRIAL_DAYS = PLANS.trial.days;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A fully-resolved entitlement view — everything the server and UI need to gate
 * behavior. Serializable (so it caches cleanly in Redis and passes to client
 * components).
 */
export interface Entitlements {
  /** The billable plan name backing this view (`trial` while trialing). */
  plan: PlanName;
  /** The capability TIER granted (`trial` grants `pro` capabilities). */
  tier: PlanTier;
  /** The lifecycle status this view was resolved from. */
  status: SubscriptionStatus;
  /** The exact features granted right now (empty when read-only). */
  features: Feature[];
  /** Included monthly SMS allowance. */
  smsIncluded: number;
  /** One-time SMS top-up balance. */
  smsTopupBalance: number;
  /** True while a past_due subscription is inside its 7-day grace window. */
  inGracePeriod: boolean;
  /** True when the account can use features (trialing/active/in-grace past_due). */
  active: boolean;
  /** Whether this groomer is a founding member (lifetime-locked pricing). */
  foundingMember: boolean;
  /** Trial end (ISO) when trialing, else null — for the UI countdown. */
  trialEndsAt: string | null;
  /** Current period end (ISO) when known, else null — for "next invoice". */
  currentPeriodEnd: string | null;
}

/**
 * The subset of a Subscription that {@link resolveEntitlements} reads. Accepting
 * a plain shape (not a Mongoose document) keeps the core pure and trivially
 * testable — tests pass literals, the DB layer passes `.lean()` results.
 */
export type SubscriptionInput = Pick<
  ISubscription,
  | 'plan'
  | 'status'
  | 'smsIncluded'
  | 'smsTopupBalance'
  | 'foundingMember'
> & {
  trialEndsAt?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
};

/** Coerce a Date | string | null into a millisecond timestamp or null. */
function toMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Coerce a Date | string | null into an ISO string or null. */
function toIso(value: Date | string | null | undefined): string | null {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

/** The read-only view all "no features" statuses collapse to. */
function readOnly(sub: SubscriptionInput, status: SubscriptionStatus): Entitlements {
  return {
    plan: sub.plan,
    tier: sub.plan === 'trial' ? 'pro' : sub.plan,
    status,
    features: [],
    smsIncluded: Math.max(0, sub.smsIncluded ?? 0),
    smsTopupBalance: Math.max(0, sub.smsTopupBalance ?? 0),
    inGracePeriod: false,
    active: false,
    foundingMember: Boolean(sub.foundingMember),
    trialEndsAt: toIso(sub.trialEndsAt),
    currentPeriodEnd: toIso(sub.currentPeriodEnd),
  };
}

/**
 * The default fresh 14-day Pro trial view used when a groomer has NO
 * subscription row yet (Master Spec §13.2). Trial starts "now".
 */
export function defaultTrialSubscription(now: Date = new Date()): SubscriptionInput {
  return {
    plan: 'trial',
    status: 'trialing',
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
    currentPeriodEnd: null,
    smsIncluded: PLANS.trial.sms,
    smsTopupBalance: 0,
    foundingMember: false,
  };
}

/**
 * PURE core: resolve a subscription (or `null`) + the current time into a full
 * {@link Entitlements} view (Master Spec §13.2 state machine). No DB / Redis /
 * Stripe. Passing `null` yields the default 14-day Pro trial view.
 *
 * @param subscription The groomer's subscription, or `null` for a fresh trial.
 * @param now The reference time (injectable for tests; defaults to real now).
 */
export function resolveEntitlements(
  subscription: SubscriptionInput | null,
  now: Date = new Date()
): Entitlements {
  const sub = subscription ?? defaultTrialSubscription(now);
  const nowMs = now.getTime();
  const tier: PlanTier = sub.plan === 'trial' ? 'pro' : sub.plan;

  /** Build the "granted" view for a plan/tier that is currently usable. */
  const granted = (
    status: SubscriptionStatus,
    inGrace: boolean
  ): Entitlements => ({
    plan: sub.plan,
    tier,
    status,
    // While trialing the plan is `trial` → Pro features; otherwise the tier's.
    features: FEATURE_KEYS.filter((f) =>
      hasFeature(sub.plan === 'trial' ? 'trial' : tier, f)
    ),
    smsIncluded: Math.max(0, sub.smsIncluded ?? 0),
    smsTopupBalance: Math.max(0, sub.smsTopupBalance ?? 0),
    inGracePeriod: inGrace,
    active: true,
    foundingMember: Boolean(sub.foundingMember),
    trialEndsAt: toIso(sub.trialEndsAt),
    currentPeriodEnd: toIso(sub.currentPeriodEnd),
  });

  switch (sub.status) {
    case 'trialing': {
      const endsMs = toMs(sub.trialEndsAt);
      // Trial with no end, or not yet elapsed → full (Pro) capabilities.
      if (endsMs == null || nowMs < endsMs) {
        return granted('trialing', false);
      }
      // Trial elapsed → expired (read-only) until they subscribe.
      return readOnly(sub, 'expired');
    }

    case 'active':
      return granted('active', false);

    case 'past_due': {
      // 7-day grace measured from currentPeriodEnd (fallback: still in grace
      // when we don't know the period end, so a data gap never locks them out
      // prematurely — the webhook will transition them to canceled/expired).
      const periodEndMs = toMs(sub.currentPeriodEnd);
      if (periodEndMs == null) return granted('past_due', true);
      const graceEndsMs = periodEndMs + GRACE_PERIOD_DAYS * DAY_MS;
      if (nowMs < graceEndsMs) return granted('past_due', true);
      // Grace elapsed → read-only.
      return readOnly(sub, 'past_due');
    }

    case 'canceled':
      return readOnly(sub, 'canceled');

    case 'expired':
    default:
      return readOnly(sub, 'expired');
  }
}

/**
 * Error thrown by {@link assertFeature} when a groomer lacks a capability or the
 * subscription is inactive. Extends {@link AppError} with a stable code and a
 * 403 status so route handlers can map it to a Forbidden response and the UI
 * can render an "Upgrade to Pro" prompt.
 */
export class FeatureLockedError extends AppError {
  /** The feature that was denied. */
  public readonly feature: Feature;
  /** Whether the block is due to an inactive subscription vs. a plan gap. */
  public readonly inactive: boolean;

  constructor(feature: Feature, inactive: boolean) {
    super(
      inactive
        ? 'Your subscription is inactive. Reactivate your plan to use this feature.'
        : 'This feature is available on the Pro plan. Upgrade to unlock it.',
      inactive ? 'SUBSCRIPTION_INACTIVE' : 'FEATURE_LOCKED',
      403
    );
    this.name = 'FeatureLockedError';
    this.feature = feature;
    this.inactive = inactive;
    Object.setPrototypeOf(this, FeatureLockedError.prototype);
  }
}

/**
 * PURE gate check used by both {@link assertFeature} and the pure tests. Returns
 * the {@link FeatureLockedError} that WOULD be thrown, or `null` when allowed.
 */
export function checkFeature(
  entitlements: Entitlements,
  feature: Feature
): FeatureLockedError | null {
  if (!entitlements.active) {
    return new FeatureLockedError(feature, true);
  }
  if (!entitlements.features.includes(feature)) {
    return new FeatureLockedError(feature, false);
  }
  return null;
}

// ---------------------------------------------------------------------------
// DB + Redis side. These use dynamic imports so the pure exports above stay
// importable from client components / tests without pulling in Mongoose.
// ---------------------------------------------------------------------------

/**
 * Load a groomer's subscription row as a plain object (or `null`). Isolated so
 * the resolution + caching stays testable via the pure core above.
 */
async function loadSubscription(groomerId: string): Promise<SubscriptionInput | null> {
  const { connectDB } = await import('@/lib/db/connect');
  const { Subscription } = await import('@/lib/db/models/subscription');
  await connectDB();
  const row = await Subscription.findOne({ groomerId })
    .select(
      'plan status trialEndsAt currentPeriodEnd smsIncluded smsTopupBalance foundingMember'
    )
    .lean<SubscriptionInput | null>();
  return row ?? null;
}

/**
 * Resolve a groomer's entitlements, cached in Redis (`ent:{gid}`, 60s).
 *
 * Cache + DB are both best-effort: if Redis is unconfigured we skip the cache;
 * if the DB read fails we fall back to the default Pro-trial view so a transient
 * outage never wrongly locks a groomer out of their tools.
 *
 * @param groomerId The groomer (User id).
 * @param now Reference time (injectable; defaults to real now).
 */
export async function getEntitlements(
  groomerId: string,
  now: Date = new Date()
): Promise<Entitlements> {
  const { isRedisConfigured, cacheGet, cacheSet, keys, TTL } = await import(
    '@/lib/redis'
  );

  // Try the cache first (best-effort).
  if (isRedisConfigured()) {
    try {
      const cached = await cacheGet<Entitlements>(keys.entitlements(groomerId));
      if (cached) return cached;
    } catch (err) {
      console.error('[entitlements] cache read failed; resolving fresh:', err);
    }
  }

  let subscription: SubscriptionInput | null = null;
  try {
    subscription = await loadSubscription(groomerId);
  } catch (err) {
    // DB hiccup: fall back to the default trial view rather than locking out.
    console.error('[entitlements] subscription load failed; using trial view:', err);
    subscription = null;
  }

  const resolved = resolveEntitlements(subscription, now);

  // Populate the cache (best-effort).
  if (isRedisConfigured()) {
    try {
      await cacheSet(keys.entitlements(groomerId), resolved, TTL.ENTITLEMENTS);
    } catch (err) {
      console.error('[entitlements] cache write failed (non-fatal):', err);
    }
  }

  return resolved;
}

/**
 * Assert a groomer may use a feature (Master Spec §13.1 "never gate only in the
 * UI"). Resolves entitlements and throws {@link FeatureLockedError} (→ 403) when
 * the plan lacks the feature or the subscription is canceled/expired/out of
 * grace. Usable directly in server actions and route handlers.
 *
 * @param groomerId The groomer (User id).
 * @param feature The capability to require.
 * @returns The resolved entitlements (handy for callers that also want to read
 *          the SMS allowance etc. after the check passes).
 * @throws {FeatureLockedError} when the feature is not permitted.
 */
export async function assertFeature(
  groomerId: string,
  feature: Feature
): Promise<Entitlements> {
  const entitlements = await getEntitlements(groomerId);
  const denied = checkFeature(entitlements, feature);
  if (denied) throw denied;
  return entitlements;
}

/**
 * Invalidate the cached entitlements for a groomer. Call this whenever the
 * Subscription row changes (webhook, top-up, plan change) so the next read
 * reflects the new state immediately rather than after the 60s TTL. Best-effort
 * and never throws.
 *
 * @param groomerId The groomer (User id).
 */
export async function invalidateEntitlements(groomerId: string): Promise<void> {
  try {
    const { isRedisConfigured, cacheDel, keys } = await import('@/lib/redis');
    if (!isRedisConfigured()) return;
    await cacheDel(keys.entitlements(groomerId));
  } catch (err) {
    console.error('[entitlements] cache invalidation failed (non-fatal):', err);
  }
}
