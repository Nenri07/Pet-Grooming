'use client';

/**
 * VerifyEmailClient — the client half of the `/verify-email` page.
 *
 * Reads the one-time `?token=` from the URL (via `useSearchParams`, which the
 * parent wraps in a Suspense boundary as the app router requires), calls the
 * {@link confirmEmailVerification} server action at most once per page load per
 * token, and renders one of three calm, theme-tokenized states:
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
 * The token is single-use, so a ref guard (`claimConfirm`) keeps effect
 * re-runs and Strict Mode remounts from sending it twice, and `update`/`router`
 * are read through refs so session loading doesn't re-trigger the confirm. The
 * flow itself lives in `@/lib/verification/email-confirm-flow`.
 *
 * On success it refreshes the live session and routes onward (R4.3, R5.3,
 * R5.4): the app is wrapped in a NextAuth `SessionProvider` at the root layout,
 * so `useSession().update()` is available here. Calling `await update()` forces
 * a `jwt` callback refresh with `trigger === 'update'`, which re-reads
 * `emailVerifiedAt` and flips `token.emailVerified` to true — so the middleware
 * stops bouncing the now-verified user back to `/verify-pending` without a
 * manual sign-out/in. We then `router.push('/onboarding')` and let the
 * middleware route onward from there.
 *
 * _Requirements: 4.3, 4.4, 5.3, 5.4, 7.3, 7.4 (confirm the token, record and
 * recognize the verified email, route onward), 13.4 (user-safe messages)._
 * _Design: §7 Verify-email client; UI → email-link confirmation page._
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { CheckCircle2, XCircle } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { confirmEmailVerification } from '@/actions/verification';
import {
  claimConfirm,
  runEmailConfirm,
  type Phase,
} from '@/lib/verification/email-confirm-flow';

export function VerifyEmailClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { update } = useSession();
  const token = searchParams.get('token') ?? '';
  const [phase, setPhase] = React.useState<Phase>({ kind: 'verifying' });

  // Refs survive re-renders and Strict Mode's simulated remount.
  const confirmedTokenRef = React.useRef<string | null>(null);
  const mountedRef = React.useRef(false);
  const updateRef = React.useRef(update);
  const routerRef = React.useRef(router);

  // Declared before the confirm effect so it is set when the confirm runs.
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the latest `update`/`router` without making them confirm deps: the
  // session finishing loading changes `update`, which used to re-send the
  // one-time token and discard the first (successful) result.
  React.useEffect(() => {
    updateRef.current = update;
    routerRef.current = router;
  });

  // Confirm at most once per page load per token. A missing token
  // short-circuits to an error without calling the action.
  React.useEffect(() => {
    if (!claimConfirm(confirmedTokenRef, token)) return;
    void runEmailConfirm(token, {
      confirm: confirmEmailVerification,
      // `update()` re-reads `emailVerifiedAt` in the jwt callback so the
      // middleware sees the verified state without a re-login (R5.3, R5.4).
      refreshSession: () => updateRef.current(),
      navigate: (href) => routerRef.current.push(href),
      isActive: () => mountedRef.current && confirmedTokenRef.current === token,
      setPhase,
    });
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
            <Link href="/onboarding" className="btn btn-primary mt-2 min-h-[44px]">
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
            <Link href="/verify-pending" className="btn btn-outline mt-2 min-h-[44px]">
              Request a new link
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}

export default VerifyEmailClient;
