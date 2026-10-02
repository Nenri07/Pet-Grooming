'use client';

/**
 * VerifyEmailClient — the client half of the `/verify-email` page.
 *
 * Reads the one-time `?token=` from the URL (via `useSearchParams`, which the
 * parent wraps in a Suspense boundary as the app router requires), calls the
 * {@link confirmEmailVerification} server action exactly once on mount, and
 * renders one of three calm, theme-tokenized states:
 *
 *   - verifying — a spinner while the action runs;
 *   - success  — "Your email is verified — you can close this tab and continue";
 *   - error    — the action's user-safe message (invalid/expired link) with a
 *                link back to start the trial / log in.
 *
 * The server action is the authority — it burns the one-time token and sets
 * `User.emailVerifiedAt`. This component only surfaces the typed envelope; it
 * never throws and never shows provider internals (R7.3/7.4, R13.4).
 *
 * _Requirements: 7.3, 7.4 (confirm the token, record verified email), 13.4
 * (user-safe messages)._
 * _Design: UI → email-link confirmation page._
 */

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { confirmEmailVerification } from '@/actions/verification';

type Phase =
  | { kind: 'verifying' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

const MSG_SUCCESS = 'Your email is verified — you can close this tab and continue.';
const MSG_MISSING_TOKEN =
  'This verification link is missing its token. Please request a new one.';

export function VerifyEmailClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [phase, setPhase] = React.useState<Phase>({ kind: 'verifying' });

  // Confirm exactly once on mount. A missing token short-circuits to an error
  // without calling the action.
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      if (token.trim() === '') {
        if (!cancelled) setPhase({ kind: 'error', message: MSG_MISSING_TOKEN });
        return;
      }
      try {
        const res = await confirmEmailVerification({ token });
        if (cancelled) return;
        if (res.ok) {
          setPhase({ kind: 'success', message: MSG_SUCCESS });
        } else {
          setPhase({ kind: 'error', message: res.message });
        }
      } catch {
        if (!cancelled) {
          setPhase({
            kind: 'error',
            message: 'Something went wrong. Please try again in a moment.',
          });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        {phase.kind === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
            <p className="text-base-content/70">Verifying your email…</p>
          </div>
        )}

        {phase.kind === 'success' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="h-12 w-12 text-success" aria-hidden="true" />
            <h1 className="font-display text-xl font-semibold text-base-content">
              Email verified
            </h1>
            <p role="status" className="text-base-content/70">
              {phase.message}
            </p>
            <Link href="/start-trial" className="btn btn-primary mt-2 min-h-[44px]">
              Continue
            </Link>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <XCircle className="h-12 w-12 text-error" aria-hidden="true" />
            <h1 className="font-display text-xl font-semibold text-base-content">
              Verification failed
            </h1>
            <p role="alert" className="text-base-content/70">
              {phase.message}
            </p>
            <Link href="/start-trial" className="btn btn-outline mt-2 min-h-[44px]">
              Back to start trial
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}

export default VerifyEmailClient;
