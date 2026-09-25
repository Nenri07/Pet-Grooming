'use client';

/**
 * Client-only "Back to login" control for the onboarding recovery card.
 *
 * Signs the user out (clearing the broken/half-provisioned session) and returns
 * them to /login, rather than leaving them stuck on a page that can't render the
 * wizard. Kept tiny and client-side because NextAuth's `signOut` runs in the
 * browser.
 */
import { signOut } from 'next-auth/react';

export function BackToLoginButton() {
  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => signOut({ callbackUrl: '/login' })}
    >
      Back to login
    </button>
  );
}
