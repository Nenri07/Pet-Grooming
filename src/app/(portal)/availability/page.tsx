import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { getAvailabilityConfig } from '@/actions/availability';
import { AvailabilityConfig } from '@/components/portal/AvailabilityConfig';

/**
 * Availability configuration page (server component shell).
 *
 * Authenticates the groomer, loads their recurring weekly windows, blocked
 * dates, and the read-only ICS feed URL via `getAvailabilityConfig` (which
 * scopes the query to the authenticated groomer's profile), and hands the
 * serializable config to the {@link AvailabilityConfig} client component, which
 * owns the weekly hours editor, blocked-dates editor, and the calendar feed
 * card.
 *
 * _Requirements: 14.1, 14.4, 14.6; Master Spec §9.6_
 */

// Availability changes as the groomer edits it; always render fresh.
export const dynamic = 'force-dynamic';

export default async function AvailabilityPage() {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer (Requirement 1.5). The
  // middleware already gates this, but we guard here so the query never runs
  // without a groomer id.
  if (!session?.user?.id) {
    redirect('/login');
  }

  const result = await getAvailabilityConfig();

  const config = result.ok
    ? result.config
    : { windows: [], blockedDates: [], feedUrl: null };

  return <AvailabilityConfig initialConfig={config} />;
}
