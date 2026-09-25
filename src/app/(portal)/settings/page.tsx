import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { getBusinessSettings } from '@/actions/settings';
import { BusinessSettings } from '@/components/portal/BusinessSettings';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ThemePicker } from '@/components/portal/ThemePicker';

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
    </div>
  );
}
