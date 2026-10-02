/**
 * Server-side hard-lockout guard for `/api` routes and server actions
 * (Billing, Trial, and Payments — Requirements 3.1, 3.3).
 *
 * The route-protection middleware enforces the hard lockout for portal *pages*
 * from a JWT claim (no DB call on the Edge). But the middleware matcher
 * EXCLUDES `/api`, so API route handlers and server actions need their own
 * server-side guard — otherwise a locked groomer could still hit mutating
 * endpoints directly. This module is that guard.
 *
 * It loads the groomer's {@link Subscription} row, maps it through the SHARED
 * pure {@link subscriptionToAccessInput} mapper (the same translation the JWT
 * callback uses, so the two can never disagree), and applies the pure
 * {@link evaluateAccess} decision. On an allow it returns; on a lockout it
 * throws a {@link PortalLockedError} (HTTP 402) that existing `AppError`-aware
 * error handling renders as a user-safe "subscribe to continue" message.
 *
 * FAIL-OPEN: any data fault (DB down, read error) resolves to "allow". A
 * transient infrastructure problem must NEVER lock a paying groomer out of
 * their own tools — mirrors the best-effort posture of `getEntitlements`.
 *
 * @see Requirements 3.1 (lock out after the trial deadline / without an active
 *   subscription), 3.3 (deny portal features while locked).
 */
import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import {
  evaluateAccess,
  subscriptionToAccessInput,
  type SubscriptionAccessRow,
} from './access';

/**
 * Thrown by {@link assertPortalAccess} when a groomer's trial has ended or
 * their subscription is inactive. Extends {@link AppError} with a stable code
 * and HTTP **402 Payment Required** so route handlers can map it to a response
 * and the UI can render an "subscribe to continue" upgrade prompt.
 *
 * Mirrors how `FeatureLockedError` in `entitlements.ts` extends `AppError`
 * (same constructor pattern + `Object.setPrototypeOf` for `instanceof` across
 * compile targets).
 */
export class PortalLockedError extends AppError {
  /** Why the portal is locked: trial elapsed vs. inactive subscription. */
  public readonly reason: 'trial_expired' | 'inactive';

  constructor(reason: 'trial_expired' | 'inactive') {
    super(
      'Your trial has ended and your subscription is inactive. Subscribe to continue.',
      'PORTAL_LOCKED',
      402
    );
    this.name = 'PortalLockedError';
    this.reason = reason;
    // Restore the prototype chain for `instanceof` on ES5-ish targets.
    Object.setPrototypeOf(this, PortalLockedError.prototype);
  }
}

/**
 * Load the access-relevant subset of a groomer's subscription row as a plain
 * object (or `null`). Isolated + dynamically imported so this guard stays
 * importable without eagerly pulling Mongoose into bundles that only need the
 * `PortalLockedError` type. Mirrors the `loadSubscription` pattern in
 * `entitlements.ts`.
 */
async function loadAccessRow(
  groomerId: string
): Promise<SubscriptionAccessRow | null> {
  const { connectDB } = await import('@/lib/db/connect');
  const { Subscription } = await import('@/lib/db/models/subscription');
  await connectDB();
  const row = await Subscription.findOne({ groomerId })
    .select('status trialDeadline trialEndsAt pastDueSince')
    .lean<SubscriptionAccessRow | null>();
  return row ?? null;
}

/**
 * Assert that a groomer may use the portal right now (Requirements 3.1, 3.3).
 *
 * Loads the subscription row, applies the shared mapper + pure
 * {@link evaluateAccess}, and throws {@link PortalLockedError} (→ 402) when the
 * trial has ended or the subscription is inactive. Returns `void` on allow.
 *
 * Use directly at the top of mutating `/api` route handlers and server actions:
 *
 * ```ts
 * await assertPortalAccess(session.user.id);
 * ```
 *
 * FAIL-OPEN: on ANY DB/read error this returns (does not throw) so a data fault
 * never locks a groomer out.
 *
 * @param groomerId The groomer (User id).
 * @param now Reference time (injectable for tests; defaults to real now).
 * @throws {PortalLockedError} when the portal is locked and the row loaded.
 */
export async function assertPortalAccess(
  groomerId: string,
  now: Date = new Date()
): Promise<void> {
  let row: SubscriptionAccessRow | null;
  try {
    row = await loadAccessRow(groomerId);
  } catch (err) {
    // Fail-open: never lock out on a data fault (Req 3.x degradation posture).
    console.error('[access-guard] subscription load failed; allowing access:', err);
    return;
  }

  const decision = evaluateAccess(subscriptionToAccessInput(row, now));
  if (!decision.allow) {
    throw new PortalLockedError(decision.reason);
  }
}

/**
 * Convenience mapper for `/api` route handlers that catch a
 * {@link PortalLockedError}: build the 402 JSON response in the same shape the
 * existing entitlement-gated routes use for `FeatureLockedError`
 * (`{ error, code, reason }` + `status`). Returns `null` for anything that is
 * NOT a {@link PortalLockedError} so callers can fall through to their own
 * handling:
 *
 * ```ts
 * try {
 *   await assertPortalAccess(session.user.id);
 * } catch (err) {
 *   const locked = portalLockedResponse(err);
 *   if (locked) return locked;
 *   throw err;
 * }
 * ```
 *
 * The project has no central error-to-response mapper, so this is an opt-in
 * helper; a route can equally just rely on `err.statusCode === 402` /
 * `err.code === 'PORTAL_LOCKED'` from the thrown {@link AppError}.
 *
 * @param err The caught error.
 * @returns A 402 `NextResponse` when `err` is a {@link PortalLockedError}, else `null`.
 */
export function portalLockedResponse(err: unknown): NextResponse | null {
  if (!(err instanceof PortalLockedError)) return null;
  return NextResponse.json(
    { error: err.message, code: err.code, reason: err.reason },
    { status: err.statusCode }
  );
}
