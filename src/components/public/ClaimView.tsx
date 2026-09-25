'use client';

/**
 * ClaimView — branded Fill My Day claim page (Master Spec §11.1).
 *
 * Shows the freed slot + groomer branding and a big Claim button. On confirm it
 * POSTs to `/api/claim/{token}/confirm`; the FIRST caller wins (server-side
 * `SET claimwon NX`) and is booked, losers get "just taken". After a win the
 * deposit-checkout seam would run before commit (see `lib/fill/claim.ts`).
 *
 * Theme tokens only; 44px+ targets.
 *
 * _Master Spec: §11.1_
 */
import * as React from 'react';
import Image from 'next/image';
import { CalendarClock, PawPrint } from 'lucide-react';

interface ClaimViewProps {
  token: string;
  business: string;
  logoUrl: string | null;
  startMs: number;
  endMs: number;
  timezone: string;
  petName: string | null;
  alreadyTaken: boolean;
}

type ClaimState = 'idle' | 'confirming' | 'won' | 'taken' | 'error';

function formatWhen(ms: number, timezone: string): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} at ${time}`;
}

export function ClaimView({
  token,
  business,
  logoUrl,
  startMs,
  endMs,
  timezone,
  petName,
  alreadyTaken,
}: ClaimViewProps) {
  const [state, setState] = React.useState<ClaimState>(alreadyTaken ? 'taken' : 'idle');

  const confirm = React.useCallback(async () => {
    setState('confirming');
    try {
      const res = await fetch(`/api/claim/${token}/confirm`, { method: 'POST' });
      if (res.ok) {
        setState('won');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (res.status === 409 || data.reason === 'taken' || data.reason === 'commit_failed') {
        setState('taken');
      } else if (res.status === 404 || data.reason === 'expired') {
        setState('error');
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }, [token]);

  const durationMin = Math.max(0, Math.round((endMs - startMs) / 60000));

  return (
    <div className="overflow-hidden rounded-box border border-base-content/10 bg-base-100 shadow-card">
      {/* Branded header */}
      <div className="bg-hero px-6 py-8 text-center">
        {logoUrl ? (
          <Image
            src={logoUrl}
            alt={business}
            width={64}
            height={64}
            className="mx-auto h-16 w-16 rounded-full object-cover ring-2 ring-base-100"
          />
        ) : (
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-base-100/80 text-primary ring-2 ring-base-100">
            <PawPrint className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
        <p className="mt-3 font-display text-xl font-semibold text-base-content">{business}</p>
      </div>

      <div className="px-6 py-7">
        {state === 'won' ? (
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-base-content">You got it! 🎉</h1>
            <p className="mt-3 text-base-content/70">
              Your spot on {formatWhen(startMs, timezone)} is booked. {business} will be in touch
              with the details.
            </p>
          </div>
        ) : state === 'taken' ? (
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-base-content">
              Just taken
            </h1>
            <p className="mt-3 text-base-content/70">
              Someone claimed this slot first. Reach out to {business} and we&apos;ll find you
              another time.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-center font-display text-2xl font-bold text-base-content">
              A spot just opened{petName ? ` for ${petName}` : ''}
            </h1>
            <div className="mt-6 flex items-start gap-3 rounded-box bg-base-200 p-4">
              <CalendarClock className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <p className="font-medium text-base-content">{formatWhen(startMs, timezone)}</p>
                {durationMin > 0 && (
                  <p className="text-sm text-base-content/60">About {durationMin} min</p>
                )}
              </div>
            </div>

            <p className="mt-4 text-center text-sm text-base-content/60">
              First to claim it wins. Tap below to grab this time.
            </p>

            <button
              type="button"
              onClick={confirm}
              disabled={state === 'confirming'}
              className="btn btn-primary mt-6 min-h-[52px] w-full text-base"
            >
              {state === 'confirming' ? 'Claiming…' : 'Claim this spot'}
            </button>

            {state === 'error' && (
              <p className="mt-3 text-center text-sm text-error" role="alert">
                Something went wrong. Please try again or contact {business}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ClaimView;
