'use client';

import * as React from 'react';
import { MessageSquare } from 'lucide-react';

/**
 * SmsCreditsPill — a small "SMS used / included" meter shown in the portal top
 * bar and as a dashboard bento cell.
 *
 * PLACEHOLDER: real SMS usage/quota wiring lands in Phase 4/5 (two-way texting +
 * quota counters in Redis). For now it renders whatever is passed in and
 * defaults to a clearly-placeholder 0/300. Colors come from theme tokens only.
 *
 * TODO(phase-4): feed `used`/`included` from the live SMS quota counter
 * (`lib/sms/quota.ts`) rather than the placeholder defaults.
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
  used = 0,
  included = 300,
  className,
}: SmsCreditsPillProps) {
  return (
    <span
      className={cx(
        'inline-flex min-h-[36px] items-center gap-1.5 rounded-badge border border-base-content/10 bg-base-200 px-3 text-xs font-medium text-base-content/70',
        className
      )}
      title="SMS credits used this cycle (placeholder — live in Phase 4)"
      aria-label={`SMS credits: ${used} of ${included} used`}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>
        SMS {used}/{included}
      </span>
    </span>
  );
}

export default SmsCreditsPill;
