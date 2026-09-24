'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { loginSchema, type LoginInput } from '@/lib/validators/auth';
import { CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { GoogleButton } from '@/components/ui/GoogleButton';

/**
 * LoginForm — client login form.
 *
 * Uses React Hook Form with a Zod resolver over the shared `loginSchema`
 * (Requirement 21.1). Validation runs `onBlur` and re-validates `onChange`, so
 * inline errors clear as the user corrects a field (Requirement 21.3), and RHF
 * preserves valid field values across a failed submit (Requirement 21.2).
 *
 * Submit flow:
 *  1. Call `signIn('credentials', { redirect: false })` so we can handle the
 *     result inline rather than letting NextAuth redirect.
 *  2. On failure show the generic "Invalid email or password" message — this
 *     covers wrong credentials AND a locked account, never disclosing which
 *     (Requirement 1.7).
 *  3. On success push to /dashboard (Requirement 1.2).
 *
 * The "Continue with Google" button renders only when `googleEnabled` is true
 * (Requirement 1.3).
 */
interface LoginFormProps {
  /** True when Google OAuth is configured server-side. */
  googleEnabled: boolean;
}

const GENERIC_LOGIN_ERROR = 'Invalid email or password';

export function LoginForm({ googleEnabled }: LoginFormProps) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);

    const result = await signIn('credentials', {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (!result || result.error) {
      // Generic message for any credential/lockout failure (Requirement 1.7).
      setFormError(GENERIC_LOGIN_ERROR);
      return;
    }

    router.push('/dashboard');
  }

  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Log in to manage your bookings.</CardDescription>
      </CardHeader>

      <CardContent>
        {formError && (
          <div role="alert" className="alert alert-error mb-4 text-sm">
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <div className="form-control">
            <label className="label" htmlFor="email">
              <span className="label-text">Email</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={`input input-bordered min-h-[44px] w-full ${
                errors.email ? 'input-error' : ''
              }`}
              aria-invalid={errors.email ? 'true' : 'false'}
              {...register('email')}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="form-control">
            <label className="label" htmlFor="password">
              <span className="label-text">Password</span>
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className={`input input-bordered min-h-[44px] w-full ${
                errors.password ? 'input-error' : ''
              }`}
              aria-invalid={errors.password ? 'true' : 'false'}
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary min-h-[44px] w-full"
          >
            {isSubmitting ? (
              <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            ) : (
              'Log in'
            )}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="divider text-xs text-base-content/50">OR</div>
            <GoogleButton callbackUrl="/dashboard" disabled={isSubmitting} />
          </>
        )}

        <p className="mt-6 text-center text-sm text-base-content/70">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="link link-primary">
            Create one
          </Link>
        </p>
      </CardContent>
    </>
  );
}

export default LoginForm;
