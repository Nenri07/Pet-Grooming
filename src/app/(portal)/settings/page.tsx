import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { getBusinessSettings } from '@/actions/settings';
import { BusinessSettings } from '@/components/portal/BusinessSettings';
import { PAGE_CLASS, PageHeader } from '@/components/portal/PageShell';
import { SettingsNav, type SettingsNavItem } from '@/components/portal/SettingsNav';
import { SettingsSection } from '@/components/portal/SettingsSection';
import { ThemePicker } from '@/components/portal/ThemePicker';
import { LogoutButton } from '@/components/portal/LogoutButton';
import { ConnectStatusCard } from '@/components/portal/ConnectStatusCard';
import { OwnStripeCard, type OwnStripeStatus } from '@/components/portal/OwnStripeCard';
import { isSecretBoxConfigured } from '@/lib/crypto/secret-box';
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

  // Groomer's own Stripe key (used while platform Connect isn't available).
  await connectDB();
  const own = await GroomerProfile.findOne({ userId: session.user.id })
    .select('ownStripeAccountName ownStripeKeyHint ownStripeLivemode ownStripeConnectedAt ownStripeWebhookId')
    .lean<{
      ownStripeAccountName?: string;
      ownStripeKeyHint?: string;
      ownStripeLivemode?: boolean;
      ownStripeConnectedAt?: Date;
      ownStripeWebhookId?: string;
    } | null>();
  const ownStripe: OwnStripeStatus = {
    available: isSecretBoxConfigured(),
    connected: Boolean(own?.ownStripeConnectedAt),
    accountName: own?.ownStripeAccountName ?? null,
    keyHint: own?.ownStripeKeyHint ?? null,
    livemode: typeof own?.ownStripeLivemode === 'boolean' ? own.ownStripeLivemode : null,
    autoConfirm: Boolean(own?.ownStripeWebhookId),
  };

  if (!result.ok) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title="Settings" />
        <div className="alert alert-error" role="alert">
          <span>{result.error}</span>
        </div>
      </div>
    );
  }

  // Order here must match the order of the sections below.
  const navItems: SettingsNavItem[] = [
    { id: 'booking-link', label: 'Booking link' },
    { id: 'profile', label: 'Business profile' },
    { id: 'deposit', label: 'Deposit' },
    { id: 'estimates', label: 'Estimate rules' },
    { id: 'service-area', label: 'Service area' },
    { id: 'payments', label: 'Payments' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'account', label: 'Account' },
  ];

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Settings"
        description="Your business profile, booking link, payments and preferences."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNav items={navItems} />
        <div className="flex min-w-0 max-w-3xl flex-col gap-6">
          <BusinessSettings initialSettings={result.settings} />
          <section id="payments" aria-label="Payments" className="scroll-mt-24">
            {connectConfigured ? (
              <ConnectStatusCard connectConfigured={connectConfigured} status={connectStatus} />
            ) : (
              <OwnStripeCard status={ownStripe} />
            )}
          </section>
          <SettingsSection
            id="appearance"
            title="Appearance"
            description="Choose light or dark. It applies instantly across your dashboard and booking pages."
          >
            <ThemePicker />
          </SettingsSection>
          <SettingsSection
            id="account"
            title="Account"
            description="Sign out of Pawxis on this device. You can log back in any time with your email and password."
          >
            <LogoutButton variant="full" />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
