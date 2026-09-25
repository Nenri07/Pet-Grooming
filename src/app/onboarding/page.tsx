import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { getOnboardingState } from '@/actions/onboarding';
import { getBusinessSettings } from '@/actions/settings';
import { listServices } from '@/actions/services';
import { getAvailabilityConfig } from '@/actions/availability';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

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

  const stateResult = await getOnboardingState();

  // Once onboarding is complete, don't re-trigger the wizard (Requirement 2.5).
  if (stateResult.ok && stateResult.state.complete) {
    redirect('/dashboard');
  }

  // Load existing data so the wizard resumes with prefilled values.
  const [settingsResult, servicesResult, availabilityResult] = await Promise.all([
    getBusinessSettings(),
    listServices(),
    getAvailabilityConfig(),
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
