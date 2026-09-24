'use server';

/**
 * Client management server actions.
 *
 * These run only on the server ('use server'). They back the Groomer Portal
 * "Clients" section: a paginated, searchable list of the authenticated
 * groomer's clients, plus a single-client detail lookup that also returns the
 * client's pets.
 *
 * Every query is scoped to the authenticated groomer (`session.user.id`), so a
 * groomer can never see another groomer's clients or pets (Requirement 10.1,
 * 10.2; design Property 7 "Client search returns only scoped results").
 *
 * _Requirements: 10.1, 10.2, 10.3_
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Client } from '@/lib/db/models/client';
import { Pet } from '@/lib/db/models/pet';

/** Maximum number of clients returned per page (Requirement 10.1). */
const PAGE_SIZE = 50;

/**
 * Escape any regular-expression special characters in a user-supplied string
 * so the search query is treated as a literal substring rather than a pattern.
 *
 * Without this, a client typing e.g. "(" or "*" would either error out or
 * match unexpectedly. We escape the full set of regex metacharacters.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the MongoDB filter for a client search.
 *
 * This helper is PURE and DB-free: given a groomer id and a raw query string it
 * returns a plain filter object. It is exported so the Property 7 test (task
 * 11.2) can assert scoping behaviour without touching the database.
 *
 * Rules:
 *  - The filter ALWAYS constrains results to the given `groomerId`, so results
 *    can never leak across groomers (Requirement 10.2 / Property 7).
 *  - Only when the trimmed query has at least one character do we add a
 *    case-insensitive `$or` regex match across name / email / phone
 *    (Requirement 10.2). An empty/whitespace query returns every client for
 *    the groomer (Requirement 10.1).
 *  - Regex special characters in the query are escaped so the input is matched
 *    literally.
 *
 * @param groomerId The authenticated groomer's id; always included in the filter.
 * @param query     The raw search string entered by the groomer.
 * @returns A MongoDB filter object scoped to the groomer.
 */
export async function buildClientSearchFilter(
  groomerId: string,
  query: string
): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = { groomerId };

  const trimmed = query.trim();
  if (trimmed.length >= 1) {
    const pattern = escapeRegExp(trimmed);
    const regex = { $regex: pattern, $options: 'i' };
    filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
  }

  return filter;
}

/** A client search result, paginated. */
export interface SearchClientsResult {
  /** The clients on the current page (plain objects). */
  clients: unknown[];
  /** Total number of clients matching the filter. */
  total: number;
  /** The 1-based page number returned. */
  page: number;
  /** Total number of pages for the current filter. */
  totalPages: number;
}

/**
 * Search / list the authenticated groomer's clients, paginated 50 per page.
 *
 * Authenticates via the NextAuth session, then queries clients scoped to that
 * groomer. With no query (or a blank one) it lists all clients; with a query of
 * at least one character it filters by partial, case-insensitive match on name,
 * email, or phone (Requirement 10.2).
 *
 * @param query The search string. Blank/whitespace lists all clients.
 * @param page  The 1-based page number (defaults to 1).
 * @throws Error('Unauthorized') when there is no authenticated groomer.
 *
 * _Requirements: 10.1, 10.2, 10.3_
 */
export async function searchClients(
  query: string,
  page: number = 1
): Promise<SearchClientsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Unauthorized');

  await connectDB();

  const currentPage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const skip = (currentPage - 1) * PAGE_SIZE;

  const filter = await buildClientSearchFilter(session.user.id, query ?? '');

  const [clients, total] = await Promise.all([
    Client.find(filter).sort({ name: 1 }).skip(skip).limit(PAGE_SIZE).lean(),
    Client.countDocuments(filter),
  ]);

  return {
    clients,
    total,
    page: currentPage,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

/** A single client plus its pets. */
export interface ClientWithPets {
  /** The client document (plain object). */
  client: unknown;
  /** The client's pets, scoped to the same groomer (plain objects). */
  pets: unknown[];
}

/**
 * Fetch a single client (scoped to the authenticated groomer) and its pets.
 *
 * The client lookup is scoped by both `_id` and `groomerId`, so a groomer can
 * only ever load their own clients (Requirement 10.4 / Property 7). The pets
 * query is likewise scoped to the client AND the groomer.
 *
 * @param clientId The id of the client to load.
 * @returns The client and its pets, or `null` when no matching client exists
 *          for this groomer.
 * @throws Error('Unauthorized') when there is no authenticated groomer.
 *
 * _Requirements: 10.4, 10.5_
 */
export async function getClientById(
  clientId: string
): Promise<ClientWithPets | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Unauthorized');

  await connectDB();

  const groomerId = session.user.id;

  const client = await Client.findOne({ _id: clientId, groomerId }).lean();
  if (!client) return null;

  const pets = await Pet.find({ clientId, groomerId }).sort({ name: 1 }).lean();

  return { client, pets };
}
