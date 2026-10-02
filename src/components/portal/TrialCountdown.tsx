import * as React from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Subscription } from '@/lib/db/models/subscription';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { computeTrialDeadline, trialDaysRemaining } from '@/lib/billing/trial';
import { TrialCountdownBanner } from './TrialCountdownBanner';

/**
 * TrialCountdown — the async SERVER wrapper that feeds
 * {@link TrialCountdownBanner} (Requirement 2).
 *
 * All billing/identity data stays on the server: this reads the authenticated
 * session, loads the groomer's {@link Subscription} row and
 * {@link GroomerProfile.timezone}, then computes the whole number of trial days
 * remaining with the pure `trialDaysRemaining` (deriving a deadline from
 * `trialDeadline` → `trialEndsAt` → a computed fallback). It passes only plain,
 * serializable props (`daysRemaining`, `ended`) into the presentational banner.
 *
 * It renders NOTHING unless the groomer is actively `trialing` (R2 — the
 * countdown is only for trialing groomers; active/past_due/canceled/expired and
 * signed-out visitors get no banner). Every failure path is fail-open-silent:
 * a missing session, missing row, or DB hiccup renders nothing rather than
 * breaking the portal shell.
 *
 * Mounted at the top of the portal `<main>` so it appears on all portal pages.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5 — Design: UI._
 */
export async function TrialCountdown({
  className,
}: {
  className?: string;
}): Promise<React.ReactElement | null> {
  let daysRemaining = 0;
  let ended = false;

  try {
    const session = await getServerSession(authOptions);
    const groomerId = session?.user?.id;
    if (!groomerId) return null;

    await connectDB();

    const sub = await Subscription.findOne({ groomerId })
      .select('status trialDeadline trialEndsAt trialStartedAt')
      .lean<{
        status: string;
        trialDeadline?: Date | null;
        trialEndsAt?: Date | null;
        trialStartedAt?: Date | null;
      } | null>();

    // Only trialing groomers see the countdown (R2). No row / any other status
    // → render nothing. A groomer with no row is a default-trial per the
    // entitlements layer, but there is no concrete deadline to count down to
    // until a trial is provisioned, so we stay silent here.
    if (!sub || sub.status !== 'trialing') return null;

    const timezone =
      (await GroomerProfile.findOne({ userId: groomerId })
        .select('timezone')
        .lean<{ timezone?: string } | null>())?.timezone || 'UTC';

    // Resolve the deadline instant: prefer the stored `trialDeadline`, fall back
    // to the legacy `trialEndsAt`, then to a computed noon-day-14 deadline from
    // `trialStartedAt` (R1.2). If none are known, there is nothing to show.
    const deadline =
      toDate(sub.trialDeadline) ??
      toDate(sub.trialEndsAt) ??
      (sub.trialStartedAt
        ? computeTrialDeadline(new Date(sub.trialStartedAt), timezone)
        : null);

    if (!deadline) return null;

    const now = new Date();
    daysRemaining = trialDaysRemaining(now, deadline, timezone);
    ended = now.getTime() >= deadline.getTime();
  } catch (err) {
    // Fail-open: never let the countdown break the portal shell.
    console.error('[TrialCountdown] resolve failed; hiding banner:', err);
    return null;
  }

  return (
    <TrialCountdownBanner
      daysRemaining={daysRemaining}
      ended={ended}
      className={className}
    />
  );
}

/** Coerce a possibly-null Date-ish value into a valid `Date`, or `null`. */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default TrialCountdown;
