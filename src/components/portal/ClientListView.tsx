'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Phone, Search, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { searchClients } from '@/actions/clients';

/**
 * ClientListView — searchable, paginated list of the groomer's clients.
 *
 * Renders a search input whose value is debounced 300ms before calling the
 * `searchClients` server action (Requirement 10.2). Results are shown 50 per
 * page as tappable cards displaying name, email, and phone; clicking a client
 * navigates to `/clients/{id}` (Requirement 10.1, 10.4 entry point). When a
 * search yields no matches a "no results" empty state is shown (Requirement
 * 10.3). Prev/Next controls page through results using the returned
 * `totalPages`.
 *
 * This is a client component so it can own the search input state, the
 * debounce, and click-to-navigate. The initial page of clients is fetched by
 * the server shell and passed in, so the first paint has data.
 *
 * Requirements:
 * - 10.1: paginated list, no more than 50 per page.
 * - 10.2: partial match on name/email/phone, debounced 300ms.
 * - 10.3: "no results" message when nothing matches.
 */

/** Serializable client row shape passed from the server component. */
export interface ClientListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface ClientListViewProps {
  /** First page of clients rendered on initial load. */
  initialClients: ClientListItem[];
  /** Total pages available for the initial (empty) query. */
  initialTotalPages: number;
}

export function ClientListView({
  initialClients,
  initialTotalPages,
}: ClientListViewProps) {
  const router = useRouter();

  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebounce(query, 300);

  const [page, setPage] = React.useState(1);
  const [clients, setClients] = React.useState<ClientListItem[]>(initialClients);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Tracks whether the user has interacted yet, so the very first render keeps
  // the server-provided initial data without a redundant fetch.
  const isFirstRun = React.useRef(true);

  // Reset to page 1 whenever the (debounced) query changes so a new search
  // never lands the user on a stale, out-of-range page.
  React.useEffect(() => {
    if (isFirstRun.current) return;
    setPage(1);
  }, [debouncedQuery]);

  React.useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    searchClients(debouncedQuery, page)
      .then((result) => {
        if (cancelled) return;
        const rows: ClientListItem[] = (result.clients as RawClient[]).map(
          (c) => ({
            id: String(c._id),
            name: c.name ?? '',
            email: c.email ?? '',
            phone: c.phone ?? '',
          })
        );
        setClients(rows);
        setTotalPages(result.totalPages);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Something went wrong loading clients. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, page]);

  const hasResults = clients.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-base-content">Clients</h1>
        <p className="mt-1 text-sm text-base-content/60">
          Search and browse your clients.
        </p>
      </header>

      <label className="input input-bordered mb-6 flex min-h-[44px] items-center gap-2">
        <Search className="h-4 w-4 text-base-content/50" aria-hidden="true" />
        <input
          type="search"
          className="grow"
          placeholder="Search by name, email, or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />
      </label>

      {error && (
        <div role="alert" className="alert alert-error mb-6">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : hasResults ? (
        <ul className="space-y-3">
          {clients.map((client) => (
            <li key={client.id}>
              <Card
                interactive
                noPadding
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/clients/${client.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/clients/${client.id}`);
                  }
                }}
              >
                <div className="flex min-h-[44px] flex-col gap-1 p-4 sm:p-5">
                  <span className="font-semibold text-base-content">
                    {client.name}
                  </span>
                  <div className="flex flex-col gap-1 text-sm text-base-content/60 sm:flex-row sm:gap-4">
                    {client.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-4 w-4" aria-hidden="true" />
                        {client.email}
                      </span>
                    )}
                    {client.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-4 w-4" aria-hidden="true" />
                        {client.phone}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Users className="h-10 w-10" aria-hidden="true" />}
          title="No clients found"
          description={
            debouncedQuery.trim().length >= 1
              ? 'No clients match your search. Try a different name, email, or phone number.'
              : 'You have no clients yet. Clients appear here after their first booking.'
          }
        />
      )}

      {hasResults && totalPages > 1 && (
        <nav
          className="mt-6 flex items-center justify-between"
          aria-label="Client list pagination"
        >
          <button
            type="button"
            className="btn btn-outline min-h-[44px]"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="text-sm text-base-content/60">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline min-h-[44px]"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

/** Raw client fields as returned (lean) from the searchClients action. */
interface RawClient {
  _id: unknown;
  name?: string;
  email?: string;
  phone?: string;
}

export default ClientListView;
