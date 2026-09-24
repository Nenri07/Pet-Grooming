import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { getPet } from '@/actions/pets';
import { PetProfile, toSerializableHistory } from '@/components/portal/PetProfile';

/**
 * Pet profile page (server component).
 *
 * Authenticates the groomer, ensures a DB connection, then loads the pet and
 * its completed-appointment service history via `getPet` (which scopes the
 * query to the authenticated groomer). When the pet does not exist within the
 * groomer's scope the page renders `notFound()`; otherwise it projects the
 * service-history dates into JSON-safe ISO strings and hands the data to the
 * `PetProfile` client component.
 *
 * _Requirements: 11.1, 11.2, 11.5, 11.6_
 */

// Always render fresh pet data (edits and newly completed services must be
// reflected rather than served from a cached snapshot).
export const dynamic = 'force-dynamic';

interface PetPageProps {
  params: { petId: string };
}

export default async function PetProfilePage({ params }: PetPageProps) {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer (Requirement 1.5). The
  // middleware already gates this, but we guard here so the query never runs
  // without a groomer id.
  if (!session?.user?.id) {
    redirect('/login');
  }

  await connectDB();

  const result = await getPet(params.petId);
  if (!result.ok) {
    // Pet not found within the groomer's scope (or unauthorized) → render the
    // not-found page rather than crashing.
    notFound();
  }

  return (
    <PetProfile
      pet={result.pet}
      serviceHistory={toSerializableHistory(result.serviceHistory)}
    />
  );
}
