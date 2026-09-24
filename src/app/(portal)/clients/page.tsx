import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { searchClients } from '@/actions/clients';
import {
  ClientListView,
  type ClientListItem,
} from '@/components/portal/ClientListView';

/**
 * Clients list page (server component shell).
 *
 * Authenticates the groomer, fetches the first page (50) of their clients via
 * the `searchClients` server action, projects them into a serializable shape,
 * and hands them to the {@link ClientListView} client component which owns the
 * debounced search, pagination, and click-to-navigate behaviour.
 *
 * _Requirements: 10.1, 10.2, 10.3_
 */

// Client data changes as bookings arrive; always render fresh.
export const dynamic = 'force-dynamic';

/** Raw client fields returned (lean) from searchClients. */
interface RawClient {
  _id: unknown;
  name?: string;
  email?: string;
  phone?: string;
}

export default async function ClientsPage() {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer (Requirement 1.5).
  if (!session?.user?.id) {
    redirect('/login');
  }

  const result = await searchClients('', 1);

  const initialClients: ClientListItem[] = (result.clients as RawClient[]).map(
    (c) => ({
      id: String(c._id),
      name: c.name ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
    })
  );

  return (
    <ClientListView
      initialClients={initialClients}
      initialTotalPages={result.totalPages}
    />
  );
}
