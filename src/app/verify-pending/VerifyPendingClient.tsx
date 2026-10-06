'use client';

/**
 * VerifyPendingClient — the client half of the `/verify-pending` page.
 *
 * An authenticated-but-unverified groomer is routed here by the middleware. On
 * first visit this component auto-sends a verification link exactly once (R1.3,
 * R10.4), shows the address the link was sent to (R3.1), and offers a resend
 * button bound to the same {@link resendEmailVerification} action (R3.2). The
 * button is disabled while a request is in flight (R3.5) and throughout the
 * server-enforced cooldown window, during which it shows a live countdown of
 * the remaining seconds (R3.4).
 *
 * It renders one of several calm, theme-tokenized states driven by the typed
 * {@link ResendCooldownResult} envelope — mirroring the look of
 * {@link VerifyEmailClient} (same Card, lucide icons, daisyUI classes,
 * `min-h-[44px]` buttons):
 *
 *   - sending            — spinner while the action runs;
 *   - sent (delivered)   — "We've sent a verification link to {email}…" (R3.3);
 *   - sent-dev           — link created but delivery unconfirmed (R3.6, R1.5);
 *   - cooldown           — resend disabled with an "Ns" countdown (R3.4);
 *   - error-recoverable  — not_configured / other user-safe messages, resend
 *                          still available to retry (R3.7).
 *
 * The server action is the authority: it burns/stores the one-time token and
 * enforces the resend cooldown across the serverless runtime regardless of what
 * this component does. The component never throws and never surfaces provider
 * internals.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 1.3, 1.5, 10.4._
 * _Design: §4 Verification-pending screen — VerifyPendingClient.tsx._
 */

import * as React from 'react';
import { CheckCircle2, Mail, MailWarning, TriangleAlert } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import {
  resendEmailVerification,
  type ResendCooldownResult,
} from '@/actions/verification';

/** Local mirror of the server's EMAIL_VERIFY_RESEND window (seconds). */
const LOCAL_COOLDOWN_SEC = 60;

const EMAIL_FALLBACK = 'your email address';

type Phase =
  | { kind: 'sending' }
  | { kind: 'sent'; message: string }
  | { kind: 'sent-dev'; message: string }
  | { kind: 'error'; message: string };

const MSG_UNEXPECTED = 'Something went wrong. Please try again in a moment.';
const MSG_NOT_CONFIGURED =
  'Verification is temporarily unavailable. Please try again shortly.';

export function VerifyPendingClient({ email }: { email: string }) {
  const displayEmail = email.trim() === '' ? EMAIL_FALLBACK : email.trim();

  const [phase, setPhase] = React.useState<Phase>({ kind: 'sending' });
  const [inFlight, setInFlight] = React.useState(false);
  const [cooldownSec, setCooldownSec] = React.useState(0);

  // Guards the auto-send so React StrictMode's double-mount only sends once
  // (R1.3, R10.4). A plain module-free ref is enough: it persists across the
  // paired mount/unmount StrictMode performs in development.
  const sentRef = React.useRef(false);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Start (or restart) the local cooldown countdown. The interval decrements
  // `cooldownSec` once per second and clears itself at zero; it is also cleaned
  // up on unmount via the effect below.
  const startCooldown = React.useCallback((seconds: number) => {
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
    if (safe <= 0) return;
    setCooldownSec(safe);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCooldownSec((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Map a ResendCooldownResult envelope onto the UI phase + cooldown.
  const applyResult = React.useCallback(
    (res: ResendCooldownResult) => {
      if (res.ok) {
        if (res.delivered) {
          setPhase({
            kind: 'sent',
            message: `We've sent a verification link to ${displayEmail}. Click it to continue.`,
          });
        } else {
          setPhase({
            kind: 'sent-dev',
            message:
              "Your link was created, but email delivery isn't fully set up — check back or contact support.",
          });
        }
        // Mirror the server's resend window locally so the button stays
        // disabled until the server would accept another send (optional; the
        // server enforces it regardless).
        startCooldown(LOCAL_COOLDOWN_SEC);
        return;
      }

      switch (res.reason) {
        case 'cooldown':
          // Resend was rejected: start the countdown from the server's
          // remaining TTL and disable resend until it reaches zero (R3.4).
          setPhase({
            kind: 'error',
            message: `You can request another link in ${Math.max(
              0,
              res.retryAfterSec
            )}s.`,
          });
          startCooldown(res.retryAfterSec);
          break;
        case 'not_configured':
          // Recoverable: let the user retry with the resend button (R3.7).
          setPhase({ kind: 'error', message: MSG_NOT_CONFIGURED });
          break;
        default:
          // Any other failure surfaces the envelope's user-safe message.
          setPhase({
            kind: 'error',
            message: res.message || MSG_UNEXPECTED,
          });
          break;
      }
    },
    [displayEmail, startCooldown]
  );

  // Shared send path used by both the auto-send and the resend button.
  const send = React.useCallback(async () => {
    setInFlight(true);
    try {
      const res = await resendEmailVerification();
      applyResult(res);
    } catch {
      setPhase({ kind: 'error', message: MSG_UNEXPECTED });
    } finally {
      setInFlight(false);
    }
  }, [applyResult]);

  // Auto-send once on mount (R1.3, R10.4).
  React.useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    void send();
  }, [send]);

  // Clean up the countdown interval on unmount.
  React.useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const cooling = cooldownSec > 0;
  const resendDisabled = inFlight || cooling;
  const resendLabel = inFlight
    ? 'Sending…'
    : cooling
      ? `Resend link (${cooldownSec}s)`
      : 'Resend link';

  const isError = phase.kind === 'error';

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-3 py-4">
          {phase.kind === 'sending' && (
            <span
              className="loading loading-spinner loading-lg text-primary"
              aria-hidden="true"
            />
          )}
          {phase.kind === 'sent' && (
            <CheckCircle2 className="h-12 w-12 text-success" aria-hidden="true" />
          )}
          {phase.kind === 'sent-dev' && (
            <MailWarning className="h-12 w-12 text-warning" aria-hidden="true" />
          )}
          {phase.kind === 'error' && (
            <TriangleAlert className="h-12 w-12 text-error" aria-hidden="true" />
          )}

          <h1 className="font-display text-xl font-semibold text-base-content">
            Verify your email
          </h1>

          {/* Always show the address the link was sent to (R3.1). */}
          <p className="flex items-center gap-2 text-base-content/70">
            <Mail className="h-4 w-4" aria-hidden="true" />
            <span>
              Sent to <span className="font-medium text-base-content">{displayEmail}</span>
            </span>
          </p>

          {phase.kind === 'sending' ? (
            <p role="status" className="text-base-content/70">
              Sending your verification link…
            </p>
          ) : (
            <p
              role={isError ? 'alert' : 'status'}
              className="text-base-content/70"
            >
              {phase.message}
            </p>
          )}

          <button
            type="button"
            className="btn btn-outline mt-2 min-h-[44px]"
            onClick={() => void send()}
            disabled={resendDisabled}
            aria-busy={inFlight}
          >
            {inFlight && (
              <span
                className="loading loading-spinner loading-sm"
                aria-hidden="true"
              />
            )}
            {resendLabel}
          </button>
        </div>
      </Card>
    </div>
  );
}

export default VerifyPendingClient;
