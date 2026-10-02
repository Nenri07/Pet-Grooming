'use server';

/**
 * Trial provisioning server action — Phase 1 of the billing/trial system
 * (Design: Stripe Flows (a) — Start no-card trial).
 *
 * {@link startTrial} is the Phase-1 entry point: it provisions the free 14-day
 * no-card trial for the authenticated groomer directly. It:
 *   1. authenticates via NextAuth and scopes strictly to `session.user.id`;
 *   2. computes the trial deadline (noon in the groomer's timezone on day 14,
 *      via the pure {@link computeTrialDeadline}) off a single `now`;
 *   3. upserts the local `Subscription` row to a `trialing` state, mirroring
 *      `trialEndsAt` to the computed `trialDeadline` so the two never drift
 *      (per design — the middleware/access-guard read `trialDeadline`, the
 *      existing `resolveEntitlements` reads `trialEndsAt`);
 *   4. invalidates the cached entitlements so the Pro-trial view takes effect
 *      immediately;
 *   5. delegates the Stripe-side trial recording to the active
 *      {@link BillingProvider} (reusing the `appUrl` return-link pattern from
 *      `actions/billing.ts`).
 *
 * CRITICAL degradation contract (R1.5): the LOCAL `trialing` row is written
 * regardless of the provider result. When Stripe Billing is Not_Configured the
 * provider is a no-op that reports `not_configured` — that is logged as
 * non-fatal and this action still returns `{ ok: true, url }` because trial
 * evaluation only needs the local row. A hard failure (e.g. a thrown DB error)
 * is caught and returned as a safe `stripe_error` envelope; nothing throws.
 *
 * The Phase-2 abuse-gate pipeline wraps this provisioning step later (task 9.2
 * as `startTrialGated`); this function stays focused on provisioning.
 *
 * _Requirements: 1.1 (start a 14-day no-card trial), 1.2 (deadline = noon on
 * day 14 in the groomer tz), 1.3 (Pro capabilities during the trial), 1.5
 * (local trialing recorded even when Stripe Billing is Not_Configured)._
 * _Design: Stripe Flows (a) — Start no-card trial._
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Subscription } from '@/lib/db/models/subscription';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { computeTrialDeadline } from '@/lib/billing/trial';
import { invalidateEntitlements } from '@/lib/billing/entitlements';
import { getBillingProvider, type BillingResult } from '@/lib/billing/provider';
import { PLANS } from '@/lib/plans';

/** Absolute app base URL for building return/success/cancel links. */
function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
  return `${base}${path}`;
}

/**
 * Start the free 14-day Pro trial (no card required) for the authenticated
 * groomer (Design: Stripe Flows (a)). Writes the local `trialing` Subscription,
 * invalidates entitlements, and delegates Stripe recording to the provider.
 *
 * Returns a typed {@link BillingResult} envelope — `{ ok: true, url }` to land
 * on, or `{ ok: false, reason, message }` — and never throws.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.5._
 */
export async function startTrial(): Promise<BillingResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      ok: false,
      reason: 'unknown_groomer',
      message: 'You must be signed in to start a trial.',
    };
  }

  const groomerId = session.user.id;
  const successUrl = appUrl('/billing?trial=started');

  try {
    await connectDB();

    // Resolve the groomer's timezone so the deadline lands on noon-local on
    // day 14 (R1.2); default to UTC when unset or the profile is missing.
    const profile = await GroomerProfile.findOne({ userId: groomerId })
      .select('timezone')
      .lean<{ timezone?: string } | null>();
    const timezone = profile?.timezone || 'UTC';

    // Single `now` anchors both the start timestamp and the computed deadline.
    const now = new Date();
    const trialStartedAt = now;
    const trialDeadline = computeTrialDeadline(now, timezone);

    // Upsert the local trialing row. `trialEndsAt` mirrors `trialDeadline` so
    // the access-guard (reads trialDeadline) and resolveEntitlements (reads
    // trialEndsAt) never disagree. $setOnInsert fixes the groomer on insert.
    await Subscription.findOneAndUpdate(
      { groomerId },
      {
        $set: {
          plan: 'trial',
          status: 'trialing',
          trialStartedAt,
          trialDeadline,
          trialEndsAt: trialDeadline,
          smsIncluded: PLANS.trial.sms,
        },
        $setOnInsert: { groomerId },
      },
      { upsert: true }
    );

    // The Pro-trial view should take effect immediately, not after the 60s TTL.
    await invalidateEntitlements(groomerId);

    // Delegate the Stripe-side trial recording. When Billing is Not_Configured
    // the provider is a no-op reporting `not_configured`; that is non-fatal —
    // the local trialing row above is what trial evaluation reads (R1.5).
    const providerResult = await getBillingProvider().startTrial({
      groomerId,
      successUrl,
      cancelUrl: appUrl('/billing'),
    });

    if (!providerResult.ok) {
      // Provider could not record (commonly: billing not set up yet). The local
      // trial write already succeeded, so treat this as a non-fatal degrade and
      // land the groomer on the started page.
      console.warn(
        `[trial] provider startTrial non-fatal (${providerResult.reason}); local trialing row written.`
      );
      return { ok: true, url: successUrl };
    }

    return providerResult;
  } catch (err) {
    console.error('[trial] startTrial failed:', err);
    return {
      ok: false,
      reason: 'stripe_error',
      message: 'We could not start your trial right now. Please try again in a moment.',
    };
  }
}
