import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { listServices } from '@/actions/services';
import { ServicesManager } from '@/components/portal/ServicesManager';

/**
 * Services management page (server component shell).
 *
 * Authenticates the groomer, loads all of their services (active + inactive)
 * via the `listServices` server action (which scopes the query to the
 * authenticated groomer), and hands the serializable rows to the
 * {@link ServicesManager} client component, which owns the create/edit forms,
 * delete confirmation, delete-blocked toast, and active/inactive toggle.
 *
 * _Requirements: 13.1, 13.2, 13.4, 13.5_
 */

// Services change as the groomer edits them; always render fresh.
export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer (Requirement 1.5). The
  // middleware already gates this, but we guard here so the query never runs
  // without a groomer id.
  if (!session?.user?.id) {
    redirect('/login');
  }

  const result = await listServices();

  return (
    <ServicesManager initialServices={result.ok ? result.services : []} />
  );
}
