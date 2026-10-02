'use client';

/**
 * StartTrialGate — the self-contained verification + start-trial flow rendered
 * by the trial-start surface (`/start-trial`) before a no-card trial is
 * provisioned (Billing, Trial, and Payments; Phase 2 abuse-prevention UI, task
 * 10.1).
 *
 * It walks a signed-in groomer through three sequential steps and only enables
 * the final "Start free trial" action once the fail-closed gates the server
 * pipeline enforces have been satisfied on the client:
 *
 *   a. EMAIL VERIFICATION — shows the signed-in email and a "Send verification
 *      email" button ({@link requestEmailVerification}). Because confirmation
 *      happens by clicking the emailed link in another tab, this step offers a
 *      plain "Continue" affordance; the server pipeline is the real enforcer —
 *      if the email isn't verified, `startTrialGated` returns `email_unverified`
 *      and this UI surfaces that inline.
 *   b. PHONE OTP — a phone input + "Send code" ({@link requestPhoneOtp}) then a
 *      6-digit code input + "Verify" ({@link confirmPhoneOtp}). On success it
 *      stores the canonical `phoneE164` the confirm action returns and marks the
 *      step done. `rate_limited` / `invalid_code` / `expired` surface the
 *      envelope's user-safe message; `not_configured` shows a labelled
 *      Not_Configured_State ("Phone verification isn't set up yet") and blocks
 *      the flow gracefully.
 *   c. START TRIAL — enabled only once the phone is verified (and an email send
 *      has been attempted). On click it computes {@link computeDeviceFingerprint}
 *      and calls {@link startTrialGated}; on `ok` it redirects to the returned
 *      success url, and on any decline reason surfaces the envelope message
 *      inline.
 *
 * DaisyUI theme tokens only, WCAG 2.1 AA contrast, 44px touch targets, calm
 * motion, per-button pending states. All server actions return typed envelopes
 * and never throw, so every branch here reads a `message` that is safe to show.
 *
 * _Requirements: 7.1 (email verification), 10.1–10.4 (phone OTP request/confirm,
 * rate limits), 13.1/13.4 (labelled Not_Configured_State, user-safe messages)._
 * _Design: UI → trial-start verification flow._
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Mail, Phone, Sparkles, CheckCircle2, Info } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import {
  requestEmailVerification,
  requestPhoneOtp,
  confirmPhoneOtp,
} from '@/actions/verification';
import { startTrialGated } from '@/actions/trial';
import { computeDeviceFingerprint } from '@/lib/identity/fingerprint.client';

/** Props projected by the `/start-trial` server page. */
export interface StartTrialGateProps {
  /** The signed-in groomer's email (for display only; the server re-reads it). */
  email: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** A small numbered step chip with a done/active/idle visual state. */
function StepBadge({
  n,
  done,
  active,
}: {
  n: number;
  done: boolean;
  active: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        done
          ? 'bg-success text-success-content'
          : active
            ? 'bg-primary text-primary-content'
            : 'bg-base-200 text-base-content/60'
      )}
    >
      {done ? <CheckCircle2 className="h-5 w-5" /> : n}
    </span>
  );
}

export function StartTrialGate({ email }: StartTrialGateProps) {
  // --- Email step -----------------------------------------------------------
  const [emailSendPending, setEmailSendPending] = React.useState(false);
  const [emailSendAttempted, setEmailSendAttempted] = React.useState(false);
  const [emailContinued, setEmailContinued] = React.useState(false);

  // --- Phone step -----------------------------------------------------------
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [sendCodePending, setSendCodePending] = React.useState(false);
  const [verifyPending, setVerifyPending] = React.useState(false);
  const [codeSent, setCodeSent] = React.useState(false);
  const [phoneE164, setPhoneE164] = React.useState<string | null>(null);
  const [phoneNotConfigured, setPhoneNotConfigured] = React.useState(false);
  const [phoneError, setPhoneError] = React.useState<string | null>(null);

  // --- Start-trial step -----------------------------------------------------
  const [startPending, setStartPending] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  const phoneVerified = phoneE164 !== null;
  // The final CTA is enabled once the phone is verified and an email send has
  // been attempted (the server enforces actual email verification).
  const canStart = phoneVerified && emailSendAttempted && !phoneNotConfigured;

  // -- Step a: send verification email --------------------------------------
  async function onSendEmail() {
    setEmailSendPending(true);
    try {
      const res = await requestEmailVerification();
      if (res.ok) {
        setEmailSendAttempted(true);
        // Surface the dev note (delivered:false) distinctly from a real send.
        if (res.delivered) {
          toast.success(res.message);
        } else {
          toast.info(res.message);
        }
      } else {
        toast.error(res.message, { duration: Infinity });
      }
    } catch {
      toast.error('Something went wrong. Please try again.', { duration: Infinity });
    } finally {
      setEmailSendPending(false);
    }
  }

  // -- Step b: send OTP ------------------------------------------------------
  async function onSendCode() {
    setPhoneError(null);
    setPhoneNotConfigured(false);
    setSendCodePending(true);
    try {
      const res = await requestPhoneOtp({ phone });
      if (res.ok) {
        setCodeSent(true);
        toast.success('We sent you a 6-digit code.');
      } else if (res.reason === 'not_configured') {
        setPhoneNotConfigured(true);
      } else {
        setPhoneError(res.message);
        toast.error(res.message, { duration: Infinity });
      }
    } catch {
      setPhoneError('Something went wrong. Please try again.');
    } finally {
      setSendCodePending(false);
    }
  }

  // -- Step b: verify OTP ----------------------------------------------------
  async function onVerifyCode() {
    setPhoneError(null);
    setVerifyPending(true);
    try {
      const res = await confirmPhoneOtp({ phone, code });
      if (res.ok) {
        setPhoneE164(res.phoneE164);
        toast.success('Your phone number is verified.');
      } else if (res.reason === 'not_configured') {
        setPhoneNotConfigured(true);
      } else {
        setPhoneError(res.message);
      }
    } catch {
      setPhoneError('Something went wrong. Please try again.');
    } finally {
      setVerifyPending(false);
    }
  }

  // -- Step c: start the gated trial ----------------------------------------
  async function onStartTrial() {
    if (!phoneE164) return;
    setStartError(null);
    setStartPending(true);
    try {
      const deviceFingerprint = await computeDeviceFingerprint();
      const res = await startTrialGated({ phoneE164, deviceFingerprint });
      if (res.ok) {
        // Land on the success url the pipeline returns (e.g. /billing?trial=started).
        window.location.href = res.url;
        return;
      }
      setStartError(res.message);
      toast.error(res.message, { duration: Infinity });
    } catch {
      setStartError('Something went wrong. Please try again.');
    } finally {
      setStartPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-base-content sm:text-3xl">
          Start your free trial
        </h1>
        <p className="mt-1 text-base-content/60">
          A couple of quick checks keep trials fair for everyone. No card needed.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {/* Step a — Email verification */}
        <Card>
          <div className="flex items-start gap-3">
            <StepBadge n={1} done={emailContinued} active={!emailContinued} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
                <h2 className="font-display text-lg font-semibold text-base-content">
                  Verify your email
                </h2>
              </div>
              <p className="mt-1 text-sm text-base-content/70">
                We&apos;ll send a verification link to{' '}
                <span className="font-medium text-base-content">{email}</span>.
                Open it in a new tab, then come back and continue.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onSendEmail()}
                  disabled={emailSendPending}
                  className="btn btn-outline btn-sm min-h-[44px]"
                >
                  {emailSendPending ? (
                    <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                  ) : emailSendAttempted ? (
                    'Resend verification email'
                  ) : (
                    'Send verification email'
                  )}
                </button>

                {emailSendAttempted && !emailContinued && (
                  <button
                    type="button"
                    onClick={() => setEmailContinued(true)}
                    className="btn btn-primary btn-sm min-h-[44px]"
                  >
                    I&apos;ve verified — continue
                  </button>
                )}
              </div>

              {emailContinued && (
                <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Thanks — we&apos;ll confirm your email when you start the trial.
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Step b — Phone OTP */}
        <Card>
          <div className="flex items-start gap-3">
            <StepBadge n={2} done={phoneVerified} active={emailContinued && !phoneVerified} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" aria-hidden="true" />
                <h2 className="font-display text-lg font-semibold text-base-content">
                  Verify your phone
                </h2>
              </div>
              <p className="mt-1 text-sm text-base-content/70">
                We&apos;ll text you a 6-digit code to confirm your number.
              </p>

              {phoneNotConfigured ? (
                <div
                  role="status"
                  className="mt-4 flex items-start gap-3 rounded-box border border-base-content/10 bg-base-200 p-4"
                >
                  <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-base-content">
                      Phone verification isn&apos;t set up yet
                    </p>
                    <p className="mt-1 text-sm text-base-content/60">
                      You can&apos;t start a trial from here until phone verification
                      is available. Please check back soon.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  <div className="form-control">
                    <label className="label" htmlFor="trial-phone">
                      <span className="label-text">Phone number</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <input
                        id="trial-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="(555) 123-4567"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        disabled={phoneVerified}
                        className="input input-bordered min-h-[44px] w-full flex-1 sm:w-auto"
                        aria-invalid={phoneError ? 'true' : 'false'}
                      />
                      <button
                        type="button"
                        onClick={() => void onSendCode()}
                        disabled={sendCodePending || phoneVerified || phone.trim() === ''}
                        className="btn btn-outline min-h-[44px]"
                      >
                        {sendCodePending ? (
                          <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                        ) : codeSent ? (
                          'Resend code'
                        ) : (
                          'Send code'
                        )}
                      </button>
                    </div>
                  </div>

                  {codeSent && !phoneVerified && (
                    <div className="form-control">
                      <label className="label" htmlFor="trial-code">
                        <span className="label-text">6-digit code</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <input
                          id="trial-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder="123456"
                          value={code}
                          onChange={(e) =>
                            setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                          }
                          className="input input-bordered min-h-[44px] w-full flex-1 tracking-widest sm:w-auto"
                          aria-invalid={phoneError ? 'true' : 'false'}
                        />
                        <button
                          type="button"
                          onClick={() => void onVerifyCode()}
                          disabled={verifyPending || code.length < 6}
                          className="btn btn-primary min-h-[44px]"
                        >
                          {verifyPending ? (
                            <span
                              className="loading loading-spinner loading-sm"
                              aria-hidden="true"
                            />
                          ) : (
                            'Verify'
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {phoneError && (
                    <p className="text-sm text-error" role="alert">
                      {phoneError}
                    </p>
                  )}

                  {phoneVerified && (
                    <p className="inline-flex items-center gap-1.5 text-sm text-success">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Phone verified.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Step c — Start the trial */}
        <Card>
          <div className="flex items-start gap-3">
            <StepBadge n={3} done={false} active={canStart} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
                <h2 className="font-display text-lg font-semibold text-base-content">
                  Start your 14-day trial
                </h2>
              </div>
              <p className="mt-1 text-sm text-base-content/70">
                Full Pro access for 14 days. No card required, cancel anytime.
              </p>

              {startError && (
                <p className="mt-3 text-sm text-error" role="alert">
                  {startError}
                </p>
              )}

              <button
                type="button"
                onClick={() => void onStartTrial()}
                disabled={!canStart || startPending}
                className="btn btn-primary mt-4 min-h-[44px] w-full sm:w-auto"
              >
                {startPending ? (
                  <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                ) : (
                  'Start free trial'
                )}
              </button>

              {!canStart && (
                <p className="mt-2 text-xs text-base-content/60">
                  Complete the steps above to start your trial.
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default StartTrialGate;
