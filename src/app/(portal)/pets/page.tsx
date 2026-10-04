import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { PawPrint } from 'lucide-react';
import { authOptions } from '@/lib/auth/config';
import { listPets } from '@/actions/pets';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Pets list page (server component).
 *
 * Authenticates the groomer, fetches their pets via the `listPets` server
 * action, and renders a calm, tappable list of cards. Each row links to the
 * pet profile (`/pets/{id}`) where the Digital Pet Card can be generated, with
 * a "Card ready" badge when a card has already been created.
 */

// Pet data changes as bookings and cards are created; always render fresh.
export const dynamic = 'force-dynamic';

export default async function PetsPage() {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer.
  if (!session?.user?.id) {
    redirect('/login');
  }

  const pets = await listPets();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-base-content">Pets</h1>
        <p className="mt-1 text-sm text-base-content/60">
          Browse your pets and open one to create a shareable Digital Pet Card.
        </p>
      </header>

      {pets.length === 0 ? (
        <EmptyState
          icon={<PawPrint className="h-10 w-10" aria-hidden="true" />}
          title="No pets yet"
          description="Pets appear here after a client books their first appointment."
        />
      ) : (
        <ul className="space-y-3">
          {pets.map((pet) => (
            <li key={pet.id}>
              <Link href={`/pets/${pet.id}`} className="block">
                <Card interactive noPadding className="cursor-pointer">
                  <div className="flex min-h-[44px] items-center justify-between gap-3 p-4 sm:p-5">
                    <div className="min-w-0 flex flex-col gap-1">
                      <span className="font-semibold text-base-content">
                        {pet.name}
                      </span>
                      <span className="text-sm text-base-content/60">
                        {pet.breed}
                        {pet.clientName ? ` · ${pet.clientName}` : ''}
                      </span>
                    </div>
                    {pet.hasCard && (
                      <span className="badge badge-success badge-sm shrink-0">
                        Card ready
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
