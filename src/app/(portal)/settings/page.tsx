import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { getBusinessSettings } from '@/actions/settings';
import { BusinessSettings } from '@/components/portal/BusinessSettings';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ThemePicker } from '@/components/portal/ThemePicker';
import { LogoutButton } from '@/components/portal/LogoutButton';
import { ConnectStatusCard } from '@/components/portal/ConnectStatusCard';
import { isConnectConfigured } from '@/lib/billing/provider';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import type { ConnectStatus } from '@/lib/billing/connect';

/**
 * Load the groomer's current Stripe Connect onboarding status for the
 * "Online payments" card (R15.1). Defaults to `not_started` when no profile
 * row exists yet or `connectStatus` is unset, and fails open (never throws) so
 * the Settings page always renders.
 */
async function loadConnectStatus(userId: string): Promise<ConnectStatus> {
  try {
    await connectDB();
    const profile = await GroomerProfile.findOne({ userId })
      .select('connectStatus')
      .lean<{ connectStatus?: ConnectStatus } | null>();
    return profile?.connectStatus ?? 'not_started';
  } catch {
    return 'not_started';
  }
}

/**
 * Business settings page (server component shell).
 *
 * Authenticates the groomer, loads their current business settings via the
 * `getBusinessSettings` server action (which scopes the query to the
 * authenticated groomer's profile), and hands the serializable values to the
 * {@link BusinessSettings} client component, which owns the business profile
 * form (name, phone, email, deposit, estimate rules, logo upload) plus the
 * separate booking-link (slug) section.
 *
 * _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6_
 */

// Settings change as the groomer edits them; always render fresh.
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer (Requirement 1.5). The
  // middleware already gates this, but we guard here so the query never runs
  // without a groomer id.
  if (!session?.user?.id) {
    redirect('/login');
  }

  const result = await getBusinessSettings();

  const connectConfigured = isConnectConfigured();
  const connectStatus = await loadConnectStatus(session.user.id);

  if (!result.ok) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="alert alert-error" role="alert">
          <span>{result.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <BusinessSettings initialSettings={result.settings} />

      <ConnectStatusCard
        connectConfigured={connectConfigured}
        status={connectStatus}
      />

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <p className="text-sm text-base-content/60">
            Pick a color theme. It applies instantly across your whole PawPort
            site — dashboard, booking pages, and everything in between.
          </p>
        </CardHeader>
        <ThemePicker />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <p className="text-sm text-base-content/60">
            Sign out of PawPort on this device. You can log back in anytime with
            your email and password.
          </p>
        </CardHeader>
        <LogoutButton variant="full" />
      </Card>
    </div>
  );
}
