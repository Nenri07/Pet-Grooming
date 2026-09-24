'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { registerSchema, type RegisterInput } from '@/lib/validators/auth';
import { registerGroomer } from '@/actions/auth';
import { CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { GoogleButton } from '@/components/ui/GoogleButton';

/**
 * RegisterForm — client registration form.
 *
 * Uses React Hook Form with a Zod resolver over the shared `registerSchema`
 * (Requirement 21.1). Validation runs `onBlur` and re-validates `onChange`, so
 * a previously invalid field's inline error clears as soon as the user corrects
 * it (Requirement 21.3). Valid field values are never wiped on a failed submit
 * because RHF owns the field state (Requirement 21.2).
 *
 * Submit flow (design.md → Registration Flow):
 *  1. Call the `registerGroomer` server action (re-validates server-side).
 *  2. On field errors, map them back onto the form; on a generic failure show a
 *     top-level error (Requirement 1.4 — no email-existence leak).
 *  3. On success, sign the user in with credentials (redirect:false) then push
 *     to /onboarding (Requirement 1.1).
 *
 * The "Continue with Google" button renders only when `googleEnabled` is true
 * (Requirement 1.3).
 */
interface RegisterFormProps {
  /** True when Google OAuth is configured server-side. */
  googleEnabled: boolean;
}

export function RegisterForm({ googleEnabled }: RegisterFormProps) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { name: '', email: '', password: '' },
  });

  async function onSubmit(values: RegisterInput) {
    setFormError(null);

    const result = await registerGroomer(values);

    if (!result.ok) {
      // Map any server-side field errors back onto their inputs (Req 21.1).
      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof RegisterInput, { type: 'server', message });
        }
      }
      // Generic top-level error (Req 1.4 — never reveals email existence).
      setFormError(
        result.error ?? 'Unable to create account. Please check your details and try again.'
      );
      return;
    }

    // Account created — sign in with the same credentials, then onboard.
    const signInResult = await signIn('credentials', {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (signInResult?.error) {
      setFormError(
        'Your account was created, but we could not sign you in automatically. Please log in.'
      );
      return;
    }

    router.push('/onboarding');
  }

  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <CardDescription>Start accepting bookings in minutes.</CardDescription>
      </CardHeader>

      <CardContent>
        {formError && (
          <div role="alert" className="alert alert-error mb-4 text-sm">
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <div className="form-control">
            <label className="label" htmlFor="name">
              <span className="label-text">Name</span>
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              className={`input input-bordered min-h-[44px] w-full ${
                errors.name ? 'input-error' : ''
              }`}
              aria-invalid={errors.name ? 'true' : 'false'}
              {...register('name')}
            />
            {errors.name && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>

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
              autoComplete="new-password"
              className={`input input-bordered min-h-[44px] w-full ${
                errors.password ? 'input-error' : ''
              }`}
              aria-invalid={errors.password ? 'true' : 'false'}
              {...register('password')}
            />
            {errors.password ? (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.password.message}
              </p>
            ) : (
              <p className="mt-1 text-xs text-base-content/60">
                At least 8 characters with an uppercase letter, a lowercase letter, and a digit.
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
              'Create account'
            )}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="divider text-xs text-base-content/50">OR</div>
            <GoogleButton callbackUrl="/onboarding" disabled={isSubmitting} />
          </>
        )}

        <p className="mt-6 text-center text-sm text-base-content/70">
          Already have an account?{' '}
          <Link href="/login" className="link link-primary">
            Log in
          </Link>
        </p>
      </CardContent>
    </>
  );
}

export default RegisterForm;
