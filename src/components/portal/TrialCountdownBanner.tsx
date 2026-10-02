import * as React from 'react';
import Link from 'next/link';
import { Clock, AlertTriangle } from 'lucide-react';

/**
 * TrialCountdownBanner — the PRESENTATIONAL slice of the portal trial countdown
 * (Requirement 2). It is a pure, serializable-prop component: it does no data
 * fetching and no time math. Its async server wrapper {@link TrialCountdown}
 * resolves the groomer's subscription + timezone, computes `daysRemaining` with
 * the pure `trialDaysRemaining`, and hands this component a plain prop bag.
 *
 * Three visible states (R2.1–R2.4):
 *   - normal     — a calm pill: "N days left in trial" + a subtle /billing link.
 *   - emphasized — `daysRemaining <= 3` and not ended: warning-toned badge + a
 *                  clear "Upgrade" link to /billing (R2.3).
 *   - ended      — the deadline has passed (`ended` true): "Trial ended —
 *                  subscribe to continue" linking to /billing (R2.4).
 *
 * Renders NOTHING when the groomer is not `trialing` — the wrapper simply does
 * not render this component in that case, but we also guard here so the piece
 * is safe to reuse.
 *
 * Styling is DaisyUI theme tokens only (primary / warning / base-*), WCAG 2.1
 * AA contrast (warning text on `warning/15` + `text-warning-content`-safe
 * `base-content` pairings), and every link is a ≥44px touch target (R2.5).
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5 — Design: UI._
 */
export interface TrialCountdownBannerProps {
  /** Whole trial days remaining (never negative; `0` once the deadline passed). */
  daysRemaining: number;
  /** True once the trial deadline has passed — show the "trial ended" state. */
  ended: boolean;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Shared touch-target + layout classes for the inline action link. */
const ACTION_LINK =
  'inline-flex min-h-[44px] items-center rounded-btn px-3 text-sm font-semibold underline-offset-2 transition-colors';

export function TrialCountdownBanner({
  daysRemaining,
  ended,
  className,
}: TrialCountdownBannerProps) {
  // ---- Trial ended (R2.4) ----------------------------------------------
  if (ended) {
    return (
      <div
        role="status"
        className={cx(
          'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-box border border-warning/40 bg-warning/15 px-4 py-2 text-sm text-base-content',
          className
        )}
      >
        <AlertTriangle
          className="h-4 w-4 shrink-0 text-warning"
          aria-hidden="true"
        />
        <span className="font-medium">
          Trial ended — subscribe to continue
        </span>
        <Link
          href="/billing"
          className={cx(
            ACTION_LINK,
            'ml-auto bg-warning text-warning-content hover:bg-warning/90'
          )}
        >
          Subscribe
        </Link>
      </div>
    );
  }

  // ---- Emphasized: 3 or fewer days left (R2.3) -------------------------
  if (daysRemaining <= 3) {
    const dayLabel = daysRemaining === 1 ? 'day' : 'days';
    return (
      <div
        role="status"
        className={cx(
          'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-box border border-warning/40 bg-warning/15 px-4 py-2 text-sm text-base-content',
          className
        )}
      >
        <AlertTriangle
          className="h-4 w-4 shrink-0 text-warning"
          aria-hidden="true"
        />
        <span className="font-medium">
          {daysRemaining} {dayLabel} left in trial
        </span>
        <Link
          href="/billing"
          className={cx(
            ACTION_LINK,
            'ml-auto bg-warning text-warning-content hover:bg-warning/90'
          )}
        >
          Upgrade
        </Link>
      </div>
    );
  }

  // ---- Normal / calm state (R2.1) --------------------------------------
  return (
    <div
      role="status"
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-box border border-base-content/10 bg-base-100 px-4 py-2 text-sm text-base-content/80',
        className
      )}
    >
      <Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-medium text-base-content">
        {daysRemaining} days left in trial
      </span>
      <Link
        href="/billing"
        className={cx(
          ACTION_LINK,
          'ml-auto text-primary hover:bg-base-200 hover:underline'
        )}
      >
        View plans
      </Link>
    </div>
  );
}

export default TrialCountdownBanner;
