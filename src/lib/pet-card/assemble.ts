/**
 * Pure assembly of the Digital Pet Card data.
 *
 * This module holds the DB-free, side-effect-free logic that turns a loaded
 * pet, its completed service history, and the groomer's branding into the
 * `PetCardData` payload (plus a `shareableUrl`) rendered on the public pet-card
 * page. Keeping the assembly pure lets it be property-tested in isolation
 * without a database (Requirement 17.1 / Property 11).
 *
 * The server action `generateDigitalPetCard` (in `src/actions/pets.ts`) loads
 * the data from MongoDB and delegates the actual shaping to
 * {@link assemblePetCard} so behavior stays in one place.
 *
 * _Requirements: 17.1_
 */
import type {
  PetCardData,
  ServiceHistoryEntry,
  GroomerBranding,
  Temperament,
  CoatCondition,
  WeightUnit,
} from '@/types';

/** Maximum number of service-history entries surfaced on the card. */
export const MAX_SERVICE_HISTORY_ENTRIES = 5;

/**
 * Compute the next recommended grooming date as the last completed service
 * date plus the groomer's configured service interval (in days).
 *
 * Pure function (no I/O, no globals). Returns `null` when there is no last
 * service date, i.e. the pet has no completed appointments yet (Requirement
 * 17.1 — next recommended date is derived from the last service).
 *
 * @param lastServiceDate The date of the most recent completed service, or null.
 * @param intervalDays    The groomer's configured service interval, in days.
 * @returns The next recommended date, or null when there is no last service.
 */
export function computeNextRecommendedDate(
  lastServiceDate: Date | null,
  intervalDays: number
): Date | null {
  if (!lastServiceDate) return null;
  const next = new Date(lastServiceDate.getTime());
  next.setDate(next.getDate() + intervalDays);
  return next;
}

/** The pet fields required to assemble a Digital Pet Card. */
export interface AssemblePetInput {
  name: string;
  photoUrl?: string;
  breed: string;
  weight: number;
  weightUnit: WeightUnit;
  age: number;
  temperament: Temperament;
  coatCondition: CoatCondition;
  specialFlags?: string[];
  notes?: string;
}

/** Inputs required to assemble a Digital Pet Card. */
export interface AssemblePetCardInput {
  /** The stable public card id. */
  cardId: string;
  /** The pet whose card is being assembled. */
  pet: AssemblePetInput;
  /**
   * The pet's completed service history, expected newest-first. Only the most
   * recent {@link MAX_SERVICE_HISTORY_ENTRIES} entries are surfaced.
   */
  serviceHistory: ServiceHistoryEntry[];
  /** The groomer's branding shown on the card. */
  branding: GroomerBranding;
  /** The groomer's configured service interval, in days. */
  intervalDays: number;
  /** The public app base URL used to build the shareable link. */
  appBaseUrl: string;
}

/** The assembled Digital Pet Card, including its shareable URL. */
export type AssembledPetCard = PetCardData & { shareableUrl: string };

/**
 * Assemble the Digital Pet Card data from already-loaded inputs.
 *
 * Pure and DB-free:
 *  - keeps the up-to-5 most recent completed service entries (slices the
 *    newest-first history to {@link MAX_SERVICE_HISTORY_ENTRIES}),
 *  - computes the next recommended date from the most recent completed service
 *    date + `intervalDays` (via {@link computeNextRecommendedDate}),
 *  - builds `shareableUrl` as `${appBaseUrl}/pet-card/${cardId}`.
 *
 * @param input The loaded pet, service history, branding, interval, and base URL.
 * @returns The `PetCardData` plus a `shareableUrl`.
 */
export function assemblePetCard(input: AssemblePetCardInput): AssembledPetCard {
  const { cardId, pet, serviceHistory, branding, intervalDays, appBaseUrl } =
    input;

  const trimmedHistory = serviceHistory.slice(0, MAX_SERVICE_HISTORY_ENTRIES);

  const lastServiceDate =
    trimmedHistory.length > 0 ? new Date(trimmedHistory[0].date) : null;
  const nextRecommendedDate = computeNextRecommendedDate(
    lastServiceDate,
    intervalDays
  );

  return {
    cardId,
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
    serviceHistory: trimmedHistory,
    nextRecommendedDate: nextRecommendedDate ?? undefined,
    branding,
    shareableUrl: `${appBaseUrl}/pet-card/${cardId}`,
  };
}
