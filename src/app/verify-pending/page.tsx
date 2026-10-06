import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';

import { VerifyPendingClient } from './VerifyPendingClient';

/**
 * Verification-pending screen (`/verify-pending`) — server shell.
 *
 * An authenticated Unverified_User is routed here by the middleware
 * (`resolveRedirect`) whenever their email is not yet verified. This server
 * component resolves the session, loads the account email, and hands off to the
 * client {@link VerifyPendingClient}, which auto-sends a verification link on
 * first visit and offers a rate-limited resend.
 *
 * This is a standalone route (a sibling of `/onboarding` and `/verify-email`):
 * it must NOT live under the portal group (those require a verified user) nor
 * the auth group (those bounce signed-in users), so the pending gate can hold a
 * signed-in but unverified user here without a redirect loop.
 *
 * The account email comes from the NextAuth session when present
 * (`session.user.email`); otherwise it is read from Mongo by user id as a
 * fallback so the screen can always display the address it is sending to.
 *
 * _Requirements: 3.1_
 * _Design: 4. Verification-pending screen — new files (page.tsx)._
 */
export const metadata: Metadata = {
  title: 'Verify your email · Pawxis',
};

export const dynamic = 'force-dynamic';

export default async function VerifyPendingPage() {
  const session = await getServerSession(authOptions);

  // Standalone authenticated route: an anonymous visitor has nothing to verify,
  // so send them to sign in first.
  if (!session?.user?.id) {
    redirect('/login');
  }

  // Prefer the session-carried email (no DB round-trip). Fall back to a direct
  // lookup by id only when the session omits it, so the screen can always show
  // the address the link is sent to (Requirement 3.1).
  let email = session.user.email ?? '';
  if (!email) {
    await connectDB();
    const user = await User.findById(session.user.id)
      .select('email')
      .lean<{ email?: string } | null>();
    email = user?.email ?? '';
  }

  return <VerifyPendingClient email={email} />;
}
