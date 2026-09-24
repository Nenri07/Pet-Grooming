'use client';

import * as React from 'react';
import { signIn } from 'next-auth/react';

/**
 * GoogleButton — "Continue with Google" OAuth sign-in trigger.
 *
 * Rendered only where Google OAuth is configured (the parent decides via the
 * server-side `isGoogleAuthEnabled` flag, Requirement 1.3). Clicking it starts
 * the NextAuth Google flow, which redirects the browser to Google's consent
 * screen and back to `callbackUrl` on success.
 *
 * Note: this button only *functions* once real GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET values are configured; with placeholders the provider is
 * not registered and this component is never rendered.
 *
 * Meets the 44x44px minimum touch-target requirement via `min-h-[44px]`.
 */
interface GoogleButtonProps {
  /** Where NextAuth should return the user after a successful sign-in. */
  callbackUrl: string;
  /** Disable while a sibling form submission is in flight. */
  disabled?: boolean;
}

export function GoogleButton({ callbackUrl, disabled = false }: GoogleButtonProps) {
  const [loading, setLoading] = React.useState(false);

  async function handleClick() {
    setLoading(true);
    // signIn with a provider redirects the browser; no need to reset loading.
    await signIn('google', { callbackUrl });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      className="btn btn-outline min-h-[44px] w-full gap-2 normal-case"
      aria-label="Continue with Google"
    >
      <GoogleIcon className="h-5 w-5" />
      Continue with Google
    </button>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export default GoogleButton;
