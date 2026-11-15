'use client';

import * as React from 'react';
import Link from 'next/link';
import { confirmPasswordReset } from '@/actions/password-reset';
import { passwordSchema } from '@/lib/validators/auth';
import { CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';

/**
 * ResetPasswordForm: sets a new password using the one-time `token` from the
 * emailed link. The same policy as registration is checked here for instant
 * feedback and again on the server, which is the source of truth.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [doneMessage, setDoneMessage] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const policy = passwordSchema.safeParse(password);
    if (!policy.success) {
      setError(policy.error.issues[0]?.message ?? 'Choose a stronger password.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const res = await confirmPasswordReset({ token, password });
      if (res.ok) setDoneMessage(res.message);
      else setError(res.message);
    } catch {
      setError('Something went wrong. Please try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <>
        <CardHeader>
          <CardTitle className="text-2xl">Link not valid</CardTitle>
          <CardDescription>This reset link is missing its token. Please request a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/forgot-password" className="btn btn-primary min-h-[44px] w-full">
            Request a new link
          </Link>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl">Choose a new password</CardTitle>
        <CardDescription>Use at least 8 characters with an uppercase letter, a lowercase letter and a number.</CardDescription>
      </CardHeader>
      <CardContent>
        {doneMessage ? (
          <div className="flex flex-col gap-4">
            <div role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-base-content">
              <span>{doneMessage}</span>
            </div>
            <Link href="/login" className="btn btn-primary min-h-[44px] w-full">
              Go to log in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            {error && (
              <div role="alert" className="alert alert-error text-sm">
                <span>{error}</span>
                {error.includes('expired') && (
                  <Link href="/forgot-password" className="link font-medium">
                    Request a new link
                  </Link>
                )}
              </div>
            )}
            <div className="form-control">
              <label className="label" htmlFor="password">
                <span className="label-text">New password</span>
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input input-bordered min-h-[44px] w-full"
              />
            </div>
            <div className="form-control">
              <label className="label" htmlFor="confirm">
                <span className="label-text">Confirm new password</span>
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input input-bordered min-h-[44px] w-full"
              />
            </div>
            <button
              type="submit"
              disabled={pending || password === '' || confirm === ''}
              className="btn btn-primary min-h-[44px] w-full"
            >
              {pending ? (
                <span className="loading loading-spinner loading-sm" aria-hidden="true" />
              ) : (
                'Update password'
              )}
            </button>
          </form>
        )}
      </CardContent>
    </>
  );
}

export default ResetPasswordForm;
