'use client';

import * as React from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

/**
 * SmsCreditsPill — a small "SMS used / included" meter shown in the portal top
 * bar and as a dashboard bento cell.
 *
 * It fetches the groomer's real allowance + usage from `/api/portal/sms-usage`
 * on mount (entitlements + the Redis usage counter, Master Spec §13.4) and
 * falls back to the placeholder defaults when the fetch fails or billing/Redis
 * is unconfigured — so it always renders and never blocks the nav. Links to the
 * billing page. Colors come from theme tokens only.
 *
 * _Master Spec: §13.4_
 */
export interface SmsCreditsPillProps {
  /** SMS messages used this cycle. Placeholder default: 0. */
  used?: number;
  /** SMS messages included in the plan this cycle. Placeholder default: 300. */
  included?: number;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function SmsCreditsPill({
  used: usedProp = 0,
  included: includedProp = 300,
  className,
}: SmsCreditsPillProps) {
  const [used, setUsed] = React.useState(usedProp);
  const [included, setIncluded] = React.useState(includedProp);

  // Best-effort live values; keep placeholder on any failure (§13.4).
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/portal/sms-usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.used === 'number') setUsed(data.used);
        if (typeof data.included === 'number') setIncluded(data.included);
      })
      .catch(() => {
        /* keep placeholder */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      href="/billing"
      className={cx(
        'inline-flex min-h-[36px] items-center gap-1.5 rounded-badge border border-base-content/10 bg-base-200 px-3 text-xs font-medium text-base-content/70 transition-colors hover:bg-base-300',
        className
      )}
      title="SMS credits used this cycle"
      aria-label={`SMS credits: ${used} of ${included} used`}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>
        SMS {used}/{included}
      </span>
    </Link>
  );
}

export default SmsCreditsPill;
