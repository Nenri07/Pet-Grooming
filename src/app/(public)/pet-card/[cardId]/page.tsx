import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connectDB } from '@/lib/db/connect';
import { Pet } from '@/lib/db/models/pet';
import { Appointment } from '@/lib/db/models/appointment';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { assemblePetCard, type AssembledPetCard } from '@/lib/pet-card/assemble';
import {
  PetCardRenderer,
  type PetCardViewData,
} from '@/components/pet-card/PetCardRenderer';
import type { ServiceHistoryEntry } from '@/types';

/**
 * Public Digital Pet Card page — /pet-card/[cardId].
 *
 * A server component rendered WITHOUT authentication (Requirement 17.5): any
 * visitor with the shareable link can view the card. The pet is looked up by
 * its `digitalCardId`; if none matches, a friendly 404 is rendered via
 * `notFound()`.
 *
 * Data assembly reuses the pure `assemblePetCard` helper: it loads the pet, the
 * pet's up-to-5 most recent completed appointments (populated with the service
 * name), and the groomer's branding + configured service interval, then shapes
 * the `PetCardData` (Requirement 17.1). When the pet has no completed services,
 * the assembled history is empty and the renderer omits the section with a
 * "No services recorded yet" message (Requirement 17.6).
 *
 * `generateMetadata` produces SEO-friendly, per-pet metadata.
 *
 * _Requirements: 17.1, 17.5, 17.6_
 */

export const dynamic = 'force-dynamic';

interface PetCardPageProps {
  params: { cardId: string };
}

/** Minimal shape of a pet as loaded for the public card. */
interface LoadedPet {
  _id: unknown;
  groomerId: unknown;
  name: string;
  photoUrl?: string;
  breed: string;
  weight: number;
  weightUnit: 'lbs' | 'kg';
  age: number;
  temperament: 'calm' | 'nervous' | 'aggressive' | 'friendly';
  coatCondition: 'smooth' | 'double' | 'wire' | 'curly' | 'long' | 'matted';
  specialFlags?: string[];
  notes?: string;
  digitalCardId?: string;
}

/**
 * Narrow a populated `serviceId` reference to its display name. When a service
 * was deleted the populated ref may be null, so fall back to a neutral label.
 */
function serviceNameOf(serviceRef: unknown): string {
  if (
    serviceRef &&
    typeof serviceRef === 'object' &&
    'name' in serviceRef &&
    typeof (serviceRef as { name: unknown }).name === 'string'
  ) {
    return (serviceRef as { name: string }).name;
  }
  return 'Service';
}

/** Load the pet by its public card id. Returns null when not found. */
async function loadPet(cardId: string): Promise<LoadedPet | null> {
  await connectDB();
  const pet = await Pet.findOne({ digitalCardId: cardId }).lean();
  return (pet as LoadedPet | null) ?? null;
}

/**
 * Assemble the full card (data + shareable URL) for a loaded pet: pull the
 * groomer's branding/interval and the pet's recent completed services, then
 * delegate to the pure `assemblePetCard`.
 */
async function assembleCard(pet: LoadedPet): Promise<AssembledPetCard> {
  const profile = await GroomerProfile.findOne({ userId: pet.groomerId })
    .select('businessName logoUrl phone businessEmail serviceIntervalDays')
    .lean();

  // Up to the 5 most recent completed appointments, newest first.
  const appointments = await Appointment.find({
    petId: pet._id,
    groomerId: pet.groomerId,
    status: 'completed',
  })
    .populate('serviceId', 'name')
    .sort({ scheduledDate: -1 })
    .limit(5)
    .lean();

  const serviceHistory: ServiceHistoryEntry[] = appointments.map((appt) => ({
    date: appt.scheduledDate,
    serviceName: serviceNameOf(appt.serviceId),
    notes: appt.postGroomNotes ?? undefined,
    status: appt.status,
  }));

  const intervalDays = profile?.serviceIntervalDays ?? 42;

  return assemblePetCard({
    cardId: pet.digitalCardId as string,
    pet: {
      name: pet.name,
      photoUrl: pet.photoUrl ?? undefined,
      breed: pet.breed,
      weight: pet.weight,
      weightUnit: pet.weightUnit,
      age: pet.age,
      temperament: pet.temperament,
      coatCondition: pet.coatCondition,
      specialFlags: pet.specialFlags ?? [],
      notes: pet.notes ?? undefined,
    },
    serviceHistory,
    branding: {
      businessName: profile?.businessName ?? '',
      logoUrl: profile?.logoUrl ?? undefined,
      phone: profile?.phone ?? undefined,
      businessEmail: profile?.businessEmail ?? undefined,
    },
    intervalDays,
    appBaseUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
  });
}

export async function generateMetadata({
  params,
}: PetCardPageProps): Promise<Metadata> {
  const pet = await loadPet(params.cardId);

  if (!pet) {
    return {
      title: 'Pet Card',
      description: 'This pet card could not be found.',
      robots: { index: false, follow: false },
    };
  }

  const title = `${pet.name}'s Pet Card`;
  const description = `View ${pet.name}'s pet card — a ${pet.breed} groomed by ${
    pet.name
  }'s groomer. See grooming history and profile details.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'profile',
      images: pet.photoUrl ? [{ url: pet.photoUrl }] : undefined,
    },
    twitter: {
      card: pet.photoUrl ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  };
}

export default async function PetCardPage({ params }: PetCardPageProps) {
  const pet = await loadPet(params.cardId);

  if (!pet) {
    notFound();
  }

  const card = await assembleCard(pet);
  const { shareableUrl, ...cardData } = card;

  // `cardData` matches PetCardData; Dates serialize to strings across the
  // server→client boundary, which PetCardViewData tolerates.
  return (
    <main className="min-h-screen bg-base-200 px-4 py-8 sm:py-12">
      <PetCardRenderer
        data={cardData as unknown as PetCardViewData}
        shareUrl={shareableUrl}
      />
    </main>
  );
}
