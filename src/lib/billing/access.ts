/**
 * Access / hard-lockout decision core (Billing, Trial, and Payments — Requirement 3).
 *
 * This module is the PURE heart of the hard-lockout feature. It turns a
 * groomer's billing state into a single allow / lockout decision and is
 * consumed by BOTH:
 *   - the route-protection middleware (via a compact JWT claim derived from it,
 *     so the Edge middleware needs no per-request DB call), and
 *   - the server-side access guard for `/api` routes and server actions.
 *
 * It imports NOTHING from Mongoose / Stripe / Redis. `now` is always an
 * explicit argument so the function is deterministic and trivially unit-tested.
 *
 * Grace semantics for `past_due` reuse the SAME {@link GRACE_PERIOD_DAYS}
 * constant that the pure `resolveEntitlements` core uses, so the hard lockout
 * and the feature-gating layer can never disagree about when a past-due
 * subscription stops being usable.
 *
 * @see Requirements 3.1 (lockout after the trial deadline / without an active
 *   subscription), 3.3 (deny portal features while locked), 3.4 (restore access
 *   once the subscription becomes `active`).
 */

import { GRACE_PERIOD_DAYS, TRIAL_DAYS } from './constants';
import type { SubscriptionStatus } from '@/lib/db/models/subscription';

/** Milliseconds in one day — local to keep this module I/O- and import-free. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fresh-trial window (days) used when a groomer has NO subscription row yet, so
 * the fail-open "fresh trial" the entitlements layer grants is reflected in the
 * lockout decision too. Reuses the same {@link TRIAL_DAYS} constant.
 */
const FRESH_TRIAL_DAYS = TRIAL_DAYS;

/**
 * The billing lifecycle states the lockout decision reasons about.
 *
 * `none` represents "no Subscription row" (the entitlements layer treats a
 * missing row as a fresh trial, but for an explicit lockout decision a `none`
 * state is a non-usable state — the caller is responsible for mapping a missing
 * row to a fail-open trial view before it ever reaches here, see Req 3.4 wiring).
 */
export type AccessState = 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';

/**
 * The exact subset of billing state the decision reads.
 *
 * @property status        Current billing lifecycle status.
 * @property trialDeadline The stored noon-in-tz trial deadline, or `null` when
 *                         unknown (legacy rows). See the null-deadline rule in
 *                         {@link evaluateAccess}.
 * @property pastDueSince  When the subscription first went `past_due` (the
 *                         grace-window anchor), or `null` if never/unknown.
 * @property now           The reference time (injected for determinism/tests).
 */
export interface AccessInput {
  status: AccessState;
  trialDeadline: Date | null;
  pastDueSince: Date | null;
  now: Date;
}

/**
 * The lockout decision. `allow: true` grants portal access; `allow: false`
 * carries a machine-readable `reason` the UI/guard maps to an upgrade prompt.
 */
export type AccessDecision =
  | { allow: true }
  | { allow: false; reason: 'trial_expired' | 'inactive' };

/** Coerce a `Date` to epoch milliseconds (invalid dates sort as past). */
function toMs(d: Date): number {
  const ms = d.getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * The hard-lockout decision (Requirement 3). PURE.
 *
 * State machine (Req 3.1, 3.3, 3.4):
 *   - `active`                                   → allow
 *   - `trialing` AND trialDeadline != null AND now < trialDeadline → allow
 *   - `trialing` AND (trialDeadline == null OR now >= trialDeadline)
 *                                                → lockout (`trial_expired`)
 *   - `past_due` AND pastDueSince != null AND now < pastDueSince + GRACE_PERIOD_DAYS
 *                                                → allow (within grace)
 *   - `past_due` beyond grace OR pastDueSince == null → lockout (`inactive`)
 *   - `canceled` | `none`                        → lockout (`inactive`)
 *
 * NULL-DEADLINE RULE (resolved per design.md): inside this pure function a
 * `trialing` row with a `null` trialDeadline resolves to lockout
 * (`trial_expired`). The design's documented fail-OPEN for missing billing data
 * lives in the WIRING layer, not here: the JWT callback (task 3.3) and the
 * read/backfill paths (task 5.3) default a missing/unresolvable billing state to
 * the entitlements trial view BEFORE calling this function, so a legitimate
 * groomer is never locked out by absent data. Keeping the pure function strict
 * is what preserves the time-monotonicity guarantee below — a pure decision
 * cannot "fail open" on a null deadline without a reference instant and still be
 * deterministically monotonic. Callers must therefore supply a resolved
 * deadline (or route missing data to the fail-open default) before relying on a
 * `trialing` decision.
 *
 * MONOTONIC IN TIME: for a fixed `status`, `trialDeadline`, and `pastDueSince`,
 * once this returns a lockout at time `t` it returns a lockout for every
 * `t' > t`. (`active` is time-independent; the `trialing`/`past_due` branches
 * only ever cross from allow → lockout as `now` increases, never back.)
 *
 * @param input The billing state + reference time.
 * @returns The allow / lockout decision.
 */
export function evaluateAccess(input: AccessInput): AccessDecision {
  const nowMs = toMs(input.now);

  switch (input.status) {
    case 'active':
      return { allow: true };

    case 'trialing': {
      // Null deadline → strict lockout here (fail-open is a wiring concern).
      if (input.trialDeadline == null) {
        return { allow: false, reason: 'trial_expired' };
      }
      if (nowMs < toMs(input.trialDeadline)) {
        return { allow: true };
      }
      return { allow: false, reason: 'trial_expired' };
    }

    case 'past_due': {
      if (input.pastDueSince != null) {
        const graceEndsMs = toMs(input.pastDueSince) + GRACE_PERIOD_DAYS * DAY_MS;
        if (nowMs < graceEndsMs) {
          return { allow: true };
        }
      }
      return { allow: false, reason: 'inactive' };
    }

    case 'canceled':
    case 'none':
    default:
      return { allow: false, reason: 'inactive' };
  }
}

/**
 * The minimal subscription shape the {@link subscriptionToAccessInput} mapper
 * reads. Accepting a plain shape (not a Mongoose document) keeps the mapper
 * pure and trivially testable — the DB layer passes a `.lean()` result, tests
 * pass literals. Mirrors the fields the entitlements `loadSubscription` selects.
 */
export interface SubscriptionAccessRow {
  status: SubscriptionStatus;
  /** Stored noon-in-tz trial deadline (preferred). */
  trialDeadline?: Date | string | null;
  /** Legacy trial end, used as the deadline fallback when `trialDeadline` is absent. */
  trialEndsAt?: Date | string | null;
  /** Grace-window anchor for `past_due`. */
  pastDueSince?: Date | string | null;
}

/** Coerce a `Date | string | null | undefined` into a `Date` or `null`. */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Map a loaded Subscription row (or `null`) + a reference time into the
 * {@link AccessInput} the pure {@link evaluateAccess} decision consumes. PURE.
 *
 * This is the SINGLE source of truth for the Subscription → {@link AccessInput}
 * translation so the NextAuth `jwt` callback (which stamps the claim middleware
 * reads) and the server-side {@link assertPortalAccess} guard can never diverge
 * on how a row becomes a lockout decision.
 *
 * Mapping rules:
 *   - No row (`null`) → a fresh-trial ALLOW: `status: 'trialing'` with a
 *     `trialDeadline` of `now + TRIAL window`, matching how the entitlements
 *     layer treats a missing row as a fresh trial (so new sign-ups are never
 *     locked out before a Subscription row exists).
 *   - `expired` status → `none` (the entitlements layer's `expired` read-only
 *     state is a non-usable state for the lockout decision; the AccessState
 *     vocabulary has no `expired`, so it collapses to `none` → lockout).
 *   - Deadline is `trialDeadline ?? trialEndsAt` (prefer the stored noon-in-tz
 *     deadline; fall back to the legacy field for rows written before 3.x).
 *
 * @param row The loaded subscription row, or `null` when none exists.
 * @param now The reference time (injected for determinism/tests).
 * @returns The {@link AccessInput} ready for {@link evaluateAccess}.
 */
export function subscriptionToAccessInput(
  row: SubscriptionAccessRow | null,
  now: Date
): AccessInput {
  // No row: treat as a fresh trial (fail-open) exactly like the entitlements
  // layer. The deadline is TRIAL_DAYS out from `now` so access is allowed.
  if (row == null) {
    return {
      status: 'trialing',
      trialDeadline: new Date(now.getTime() + FRESH_TRIAL_DAYS * DAY_MS),
      pastDueSince: null,
      now,
    };
  }

  // Map the lifecycle status into the AccessState vocabulary. The only
  // divergence is `expired` → `none` (AccessState has no `expired`).
  const status: AccessState = row.status === 'expired' ? 'none' : row.status;

  return {
    status,
    trialDeadline: toDate(row.trialDeadline) ?? toDate(row.trialEndsAt),
    pastDueSince: toDate(row.pastDueSince),
    now,
  };
}

/**
 * Compact representation of the access-relevant billing state, stamped onto the
 * NextAuth JWT so the Edge middleware can decide lockout WITHOUT a DB call.
 *
 * Dates are flattened to epoch-millisecond numbers (or `null`) to keep the
 * token small and JSON-safe.
 *
 * @property st Billing lifecycle status.
 * @property dl Trial deadline as epoch ms, or `null`.
 * @property pd `pastDueSince` as epoch ms, or `null`.
 */
export interface AccessClaim {
  st: AccessState;
  dl: number | null;
  pd: number | null;
}

/**
 * Build the compact JWT claim from the billing state (for the `jwt` callback).
 * Drops `now` — the consumer supplies a fresh `now` when it evaluates.
 *
 * @param input The billing state (without `now`).
 * @returns The serializable claim.
 */
export function toAccessClaim(input: Omit<AccessInput, 'now'>): AccessClaim {
  return {
    st: input.status,
    dl: input.trialDeadline == null ? null : input.trialDeadline.getTime(),
    pd: input.pastDueSince == null ? null : input.pastDueSince.getTime(),
  };
}

/**
 * Reconstruct an {@link AccessInput} from a compact {@link AccessClaim} and a
 * reference time, then run {@link evaluateAccess}. Used by the middleware.
 *
 * Round-trip guarantee: for any `x: AccessInput`,
 *   `accessFromClaim(toAccessClaim(x), x.now)` deep-equals `evaluateAccess(x)`.
 *
 * @param claim The compact claim from the JWT.
 * @param now   The reference time to evaluate against.
 * @returns The allow / lockout decision.
 */
export function accessFromClaim(claim: AccessClaim, now: Date): AccessDecision {
  return evaluateAccess({
    status: claim.st,
    trialDeadline: claim.dl == null ? null : new Date(claim.dl),
    pastDueSince: claim.pd == null ? null : new Date(claim.pd),
    now,
  });
}
