import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { getOnboardingState } from '@/actions/onboarding';
import { ensureGroomerProfile } from '@/actions/profile-ensure';
import { getBusinessSettings } from '@/actions/settings';
import { listServices } from '@/actions/services';
import { getAvailabilityConfig } from '@/actions/availability';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { BackToLoginButton } from './BackToLoginButton';

/**
 * Onboarding page (server component shell).
 *
 * Guards the route (unauthenticated visitors go to /login), and — WHERE
 * onboarding is already complete — redirects to the dashboard so a finished
 * groomer never re-enters the wizard (Requirement 2.5, second clause). For an
 * incomplete groomer it loads the current `onboardingStep` plus any existing
 * settings, services, and availability so the wizard resumes with prefilled
 * data (Requirement 2.2 / 2.5), then renders the client {@link OnboardingWizard}.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
 */

// The wizard reflects live per-groomer state; always render fresh.
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions);

  // Portal-adjacent route: require an authenticated groomer (Requirement 1.5).
  if (!session?.user?.id) {
    redirect('/login');
  }

  let stateResult = await getOnboardingState();

  // Defensive guard against a blank/looping onboarding page: if the profile is
  // genuinely missing (e.g. a half-provisioned OAuth account or a transient DB
  // error during sign-in), the wizard would render against nothing and the
  // middleware would keep bouncing the user here. Best-effort create/ensure the
  // profile and retry the state read ONCE before giving up.
  if (!stateResult.ok) {
    const ensured = await ensureGroomerProfile();
    if (ensured.ok) {
      stateResult = await getOnboardingState();
    }
  }

  // Once onboarding is complete, don't re-trigger the wizard (Requirement 2.5).
  if (stateResult.ok && stateResult.state.complete) {
    redirect('/dashboard');
  }

  // If we STILL can't load the onboarding state after ensuring the profile,
  // render a friendly recovery card instead of a blank, looping page.
  if (!stateResult.ok) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body items-center text-center">
            <h1 className="card-title">We couldn&apos;t open your onboarding</h1>
            <p className="text-base-content/70">
              Something went wrong setting up your business profile. Please sign
              back in and try again — if it keeps happening, contact support.
            </p>
            <div className="card-actions mt-4">
              <BackToLoginButton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Load existing data so the wizard resumes with prefilled values. Each action
  // is defended so a single failing load can't throw the whole server render;
  // it falls back to its empty/ok-false shape and the wizard starts fresh.
  const [settingsResult, servicesResult, availabilityResult] = await Promise.all([
    getBusinessSettings().catch(
      () => ({ ok: false, error: 'load failed' }) as const
    ),
    listServices().catch(() => ({ ok: false, error: 'load failed' }) as const),
    getAvailabilityConfig().catch(
      () => ({ ok: false, error: 'load failed' }) as const
    ),
  ]);

  const settings = settingsResult.ok ? settingsResult.settings : null;

  return (
    <OnboardingWizard
      initialStep={stateResult.ok ? stateResult.state.step : 0}
      initialBusiness={{
        businessName: settings?.businessName ?? '',
        phone: settings?.phone ?? '',
        businessEmail: settings?.businessEmail ?? '',
        groomerSlug: settings?.groomerSlug ?? '',
        logoUrl: settings?.logoUrl ?? '',
        depositAmount: settings?.depositAmount ?? 25,
        estimateRules: settings?.estimateRules ?? [],
      }}
      initialServices={servicesResult.ok ? servicesResult.services : []}
      initialAvailability={
        availabilityResult.ok
          ? availabilityResult.config
          : { windows: [], blockedDates: [], feedUrl: null }
      }
    />
  );
}
