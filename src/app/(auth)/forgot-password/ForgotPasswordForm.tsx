'use client';

import * as React from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '@/actions/password-reset';
import { CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';

/**
 * ForgotPasswordForm: asks for an email and requests a reset link.
 * The server answers the same way whether or not the account exists, so this
 * form shows the server's message verbatim and never hints at account status.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sentMessage, setSentMessage] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await requestPasswordReset({ email });
      if (res.ok) setSentMessage(res.message);
      else setError(res.message);
    } catch {
      setError('Something went wrong. Please try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>
          Enter the email you signed up with and we&apos;ll send you a link to choose a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sentMessage ? (
          <div className="flex flex-col gap-4">
            <div role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-base-content">
              <span>{sentMessage}</span>
            </div>
            <p className="text-sm text-base-content/70">
              Didn&apos;t get it? Check your spam folder, or wait a minute and try again.
            </p>
            <Link href="/login" className="btn btn-primary min-h-[44px] w-full">
              Back to log in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            {error && (
              <div role="alert" className="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            )}
            <div className="form-control">
              <label className="label" htmlFor="email">
                <span className="label-text">Email</span>
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input input-bordered min-h-[44px] w-full"
              />
            </div>
            <button type="submit" disabled={pending || email.trim() === ''} className="btn btn-primary min-h-[44px] w-full">
              {pending ? (
                <span className="loading loading-spinner loading-sm" aria-hidden="true" />
              ) : (
                'Send reset link'
              )}
            </button>
            <p className="text-center text-sm text-base-content/70">
              <Link href="/login" className="link link-primary">
                Back to log in
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </>
  );
}

export default ForgotPasswordForm;
