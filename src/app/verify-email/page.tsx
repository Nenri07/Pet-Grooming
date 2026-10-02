import { Suspense } from 'react';
import type { Metadata } from 'next';

import { VerifyEmailClient } from './VerifyEmailClient';

/**
 * Email-link confirmation page (`/verify-email?token=…`).
 *
 * A user lands here from the verification link emailed by
 * `requestEmailVerification`. The actual confirmation (reading `?token=`,
 * calling `confirmEmailVerification`, and rendering success/invalid states)
 * happens in {@link VerifyEmailClient}; because that reads `useSearchParams`,
 * the app router requires it to sit inside a Suspense boundary, which this
 * server component provides.
 *
 * This route is public (it is NOT a portal route): a user may click the link
 * from any tab or device without an active session, and the server action
 * resolves the account from the token itself.
 *
 * _Requirements: 7.3, 7.4._
 * _Design: UI → email-link confirmation page._
 */
export const metadata: Metadata = {
  title: 'Verify your email · Pawxis',
};

export const dynamic = 'force-dynamic';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailClient />
    </Suspense>
  );
}
