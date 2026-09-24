import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Mail, Phone, MapPin, PawPrint } from 'lucide-react';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { getClientById } from '@/actions/clients';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Client detail page (server component).
 *
 * Authenticates the groomer, connects to the database, and loads a single
 * client (scoped to the groomer) along with its pets via `getClientById`.
 * Renders the client's contact info (name, email, phone, address) and a list
 * of associated pets, each linking to its full profile at `/pets/{petId}`.
 * When no matching client exists for this groomer, renders a 404.
 *
 * _Requirements: 10.4, 10.5_
 */

export const dynamic = 'force-dynamic';

interface LeanAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

interface LeanClient {
  _id: unknown;
  name?: string;
  email?: string;
  phone?: string;
  address?: LeanAddress | null;
}

interface LeanPet {
  _id: unknown;
  name?: string;
  breed?: string;
}

function formatAddress(address?: LeanAddress | null): string | null {
  if (!address) return null;
  const parts = [
    address.street,
    address.city,
    address.state,
    address.postalCode,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(', ') : null;
}

export default async function ClientDetailPage({
  params,
}: {
  params: { clientId: string };
}) {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer (Requirement 1.5).
  if (!session?.user?.id) {
    redirect('/login');
  }

  await connectDB();

  const result = await getClientById(params.clientId);

  // No matching client for this groomer → 404 (Requirement 10.4 scoping).
  if (!result) {
    notFound();
  }

  const client = result.client as LeanClient;
  const pets = result.pets as LeanPet[];
  const address = formatAddress(client.address);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6">
        <Link
          href="/clients"
          className="link link-hover text-sm text-base-content/60"
        >
          &larr; Back to clients
        </Link>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-2xl">{client.name}</CardTitle>
        </CardHeader>
        <dl className="flex flex-col gap-3 text-sm">
          {client.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-base-content/50" aria-hidden="true" />
              <dt className="sr-only">Email</dt>
              <dd>
                <a href={`mailto:${client.email}`} className="link link-hover">
                  {client.email}
                </a>
              </dd>
            </div>
          )}
          {client.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-base-content/50" aria-hidden="true" />
              <dt className="sr-only">Phone</dt>
              <dd>
                <a href={`tel:${client.phone}`} className="link link-hover">
                  {client.phone}
                </a>
              </dd>
            </div>
          )}
          {address && (
            <div className="flex items-start gap-2">
              <MapPin
                className="mt-0.5 h-4 w-4 text-base-content/50"
                aria-hidden="true"
              />
              <dt className="sr-only">Address</dt>
              <dd className="text-base-content/80">{address}</dd>
            </div>
          )}
        </dl>
      </Card>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-base-content">
          Pets ({pets.length})
        </h2>

        {pets.length > 0 ? (
          <ul className="space-y-3">
            {pets.map((pet) => {
              const petId = String(pet._id);
              return (
                <li key={petId}>
                  <Link href={`/pets/${petId}`} className="block">
                    <Card interactive noPadding className="cursor-pointer">
                      <div className="flex min-h-[44px] items-center gap-3 p-4 sm:p-5">
                        <PawPrint
                          className="h-6 w-6 text-primary"
                          aria-hidden="true"
                        />
                        <div className="flex flex-col">
                          <span className="font-semibold text-base-content">
                            {pet.name}
                          </span>
                          {pet.breed && (
                            <span className="text-sm text-base-content/60">
                              {pet.breed}
                            </span>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<PawPrint className="h-10 w-10" aria-hidden="true" />}
            title="No pets yet"
            description="This client has no pets on file. Pets appear here after they are added to a booking."
          />
        )}
      </section>
    </div>
  );
}
