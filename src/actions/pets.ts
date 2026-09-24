'use server';

/**
 * Pet profile server actions for the Groomer Portal.
 *
 * These run only on the server ('use server'). All three actions authenticate
 * the caller via NextAuth and scope every query to the authenticated groomer
 * (`groomerId: session.user.id`) so one groomer can never read or mutate
 * another groomer's pets.
 *
 *  - `getPet` loads a pet plus its completed-appointment service history
 *    (reverse-chronological), for the Pet profile view (Requirement 11.1/11.2).
 *  - `updatePet` validates edits with `petEditSchema` and BLOCKS persistence
 *    when any required field is invalid, returning field errors instead of
 *    saving and never showing a confirmation (Requirement 11.5/11.6).
 *  - `generateDigitalPetCard` assigns a stable public card id, assembles the
 *    Digital Pet Card data (pet info, up to the 5 most recent completed
 *    services, next recommended date, and groomer branding) and only returns a
 *    card when assembly succeeds (Requirement 11.3/11.4).
 *
 * _Requirements: 11.1, 11.3, 11.5, 11.6_
 */
import { getServerSession } from 'next-auth';
import { nanoid } from 'nanoid';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Pet } from '@/lib/db/models/pet';
import { Appointment } from '@/lib/db/models/appointment';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { petEditSchema, type PetEditFormInput } from '@/lib/validators/pet';
import {
  assemblePetCard,
  computeNextRecommendedDate,
} from '@/lib/pet-card/assemble';
import type {
  PetCardData,
  ServiceHistoryEntry,
  Temperament,
  CoatCondition,
  WeightUnit,
} from '@/types';

/** Length of the generated public Digital Pet Card id. */
const CARD_ID_LENGTH = 12;

// Re-export the pure next-recommended-date helper so existing importers keep
// working after it moved into the DB-free pet-card assembly module.
export { computeNextRecommendedDate };

// ---------------------------------------------------------------------------
// Shared result envelopes
// ---------------------------------------------------------------------------

/** A serializable service-history entry as returned by `getPet`. */
export interface PetServiceHistoryEntry {
  appointmentId: string;
  date: Date;
  serviceName: string;
  notes?: string;
  status: string;
}

/** The pet fields projected onto the Pet profile view. */
export interface PetProfile {
  id: string;
  clientId: string;
  name: string;
  photoUrl?: string;
  breed: string;
  weight: number;
  weightUnit: WeightUnit;
  age: number;
  temperament: Temperament;
  coatCondition: CoatCondition;
  specialFlags: string[];
  notes?: string;
  digitalCardId?: string;
}

/** Result envelope returned by {@link getPet}. */
export type GetPetResult =
  | { ok: true; pet: PetProfile; serviceHistory: PetServiceHistoryEntry[] }
  | { ok: false; error: string };

/** Result envelope returned by {@link updatePet}. */
export type UpdatePetResult =
  | { ok: true }
  | { ok: false; error?: string; fieldErrors?: Record<string, string[]> };

/**
 * The Digital Pet Card payload. Extends the canonical `PetCardData` with the
 * `shareableUrl` the portal copies to the clipboard / uses for the public page.
 */
export type DigitalPetCard = PetCardData & { shareableUrl: string };

/** Result envelope returned by {@link generateDigitalPetCard}. */
export type GenerateCardResult =
  | { ok: true; card: DigitalPetCard }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Narrow a populated `serviceId` reference to its display name. Appointments
 * are populated with `serviceId: { name }`; when a service was deleted the
 * populated ref may be null, so fall back to a neutral label.
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

// ---------------------------------------------------------------------------
// getPet
// ---------------------------------------------------------------------------

/**
 * Load a pet owned by the authenticated groomer, along with its service
 * history: all completed appointments for that pet, populated with the service
 * name, in reverse-chronological order (most recent first) — Requirement 11.2.
 *
 * Returns an error envelope (rather than throwing) when the caller is not
 * authenticated or the pet does not exist within the groomer's scope, so the
 * page can render a not-found / unauthorized state without a crash.
 */
export async function getPet(petId: string): Promise<GetPetResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'Unauthorized' };
  }

  try {
    await connectDB();

    const pet = await Pet.findOne({
      _id: petId,
      groomerId: session.user.id,
    }).lean();

    if (!pet) {
      return { ok: false, error: 'Pet not found.' };
    }

    // Completed appointments for this pet, newest first (Requirement 11.2).
    const appointments = await Appointment.find({
      petId: pet._id,
      groomerId: session.user.id,
      status: 'completed',
    })
      .populate('serviceId', 'name')
      .sort({ scheduledDate: -1 })
      .lean();

    const serviceHistory: PetServiceHistoryEntry[] = appointments.map((appt) => ({
      appointmentId: String(appt._id),
      date: appt.scheduledDate,
      serviceName: serviceNameOf(appt.serviceId),
      notes: appt.postGroomNotes ?? undefined,
      status: appt.status,
    }));

    const profile: PetProfile = {
      id: String(pet._id),
      clientId: String(pet.clientId),
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
      digitalCardId: pet.digitalCardId ?? undefined,
    };

    return { ok: true, pet: profile, serviceHistory };
  } catch (error) {
    console.error('getPet failed:', error);
    return { ok: false, error: "We couldn't load this pet. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// updatePet
// ---------------------------------------------------------------------------

/**
 * Validate and persist edits to a pet owned by the authenticated groomer.
 *
 * Validation runs with `petEditSchema`. When ANY required field is invalid the
 * action returns `{ ok: false, fieldErrors }` and DOES NOT persist anything, so
 * the caller shows inline errors and no confirmation (Requirement 11.5/11.6).
 * Only when all fields are valid is the update written, scoped to the groomer.
 */
export async function updatePet(
  petId: string,
  input: PetEditFormInput
): Promise<UpdatePetResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'Unauthorized' };
  }

  // Server-side validation. On failure, block persistence (Requirement 11.5).
  const parsed = petEditSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<
      string,
      string[]
    >;
    return { ok: false, fieldErrors };
  }

  const data = parsed.data;

  try {
    await connectDB();

    const result = await Pet.updateOne(
      { _id: petId, groomerId: session.user.id },
      {
        $set: {
          name: data.name,
          breed: data.breed,
          weight: data.weight,
          weightUnit: data.weightUnit,
          age: data.age,
          temperament: data.temperament,
          coatCondition: data.coatCondition,
          specialFlags: data.specialFlags ?? [],
          notes: data.notes ? data.notes : undefined,
        },
      }
    );

    if (result.matchedCount === 0) {
      return { ok: false, error: 'Pet not found.' };
    }

    return { ok: true };
  } catch (error) {
    console.error('updatePet failed:', error);
    return { ok: false, error: "We couldn't save your changes. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// generateDigitalPetCard
// ---------------------------------------------------------------------------

/**
 * Generate (or refresh) the Digital Pet Card for a pet owned by the
 * authenticated groomer.
 *
 * Assigns a stable public `digitalCardId` (nanoid) the first time, then
 * assembles the card from the pet, the up-to-5 most recent completed
 * appointments (populated with the service name), the next recommended date
 * (via {@link computeNextRecommendedDate}), and the groomer's branding.
 *
 * A card is ONLY returned when assembly succeeds (Requirement 11.3); on any
 * failure the action returns `{ ok: false, error }` and the Pet profile view is
 * preserved without data loss (Requirement 11.4).
 */
export async function generateDigitalPetCard(
  petId: string
): Promise<GenerateCardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'Unauthorized' };
  }

  try {
    await connectDB();

    const pet = await Pet.findOne({
      _id: petId,
      groomerId: session.user.id,
    });

    if (!pet) {
      return { ok: false, error: 'Pet not found.' };
    }

    // Assign a stable public card id the first time the card is generated.
    if (!pet.digitalCardId) {
      pet.digitalCardId = nanoid(CARD_ID_LENGTH);
      await pet.save();
    }
    const cardId = pet.digitalCardId;

    // Up to the 5 most recent completed appointments, newest first.
    const appointments = await Appointment.find({
      petId: pet._id,
      groomerId: session.user.id,
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

    // Groomer branding + configured service interval for the next-visit date.
    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select('businessName logoUrl phone businessEmail serviceIntervalDays')
      .lean();

    const intervalDays = profile?.serviceIntervalDays ?? 42;

    // Delegate the DB-free shaping to the pure assembly helper so behavior
    // stays in one place (Requirement 17.1 / Property 11).
    const card: DigitalPetCard = assemblePetCard({
      cardId,
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

    return { ok: true, card };
  } catch (error) {
    console.error('generateDigitalPetCard failed:', error);
    return {
      ok: false,
      error: "We couldn't generate the pet card. Please try again.",
    };
  }
}
