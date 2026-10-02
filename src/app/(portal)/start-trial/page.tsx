import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth/config';
import { StartTrialGate } from '@/components/trial/StartTrialGate';

/**
 * Start-trial page (server component) — the surface that hosts the abuse-gated
 * verification + trial-start flow for a signed-in groomer who has not yet
 * started a trial (Billing, Trial, and Payments; Phase 2, task 10.1).
 *
 * It lives under `(portal)`, so the middleware already requires an
 * authenticated session; the explicit redirect here mirrors the billing page
 * and guards against the session being unexpectedly absent. A brand-new
 * groomer with no subscription row is fail-open in the JWT access claim, so the
 * lockout rule never traps them before they can start a trial (R3 lockout only
 * applies to an onboarded groomer whose access is a resolved lockout).
 *
 * The signed-in email is passed to the client {@link StartTrialGate} for
 * display only — the server pipeline (`startTrialGated`) always re-reads the
 * authoritative email from the session user.
 *
 * _Requirements: 7.1, 10.1._
 * _Design: UI → trial-start verification flow._
 */
export const metadata: Metadata = {
  title: 'Start your free trial · Pawxis',
};

export const dynamic = 'force-dynamic';

export default async function StartTrialPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login');
  }

  const email = session.user.email ?? '';

  return (
    <div className="py-6">
      <StartTrialGate email={email} />
    </div>
  );
}
