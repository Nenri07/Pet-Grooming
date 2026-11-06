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
// Import the pure interval module directly (not the rebooking barrel) so this
// module stays DB-free.
import { computeNextDueAt, isKnownCoat } from '@/lib/rebooking/interval';

/** Maximum number of service-history entries surfaced on the card. */
export const MAX_SERVICE_HISTORY_ENTRIES = 5;

/** Inputs for {@link computeNextRecommendedDate}. */
export interface NextRecommendedDateInput {
  /** The pet's stored next-due date (set when an appointment is completed). */
  nextDueAt?: Date | string | null;
  /** The date of the most recent completed service, or null. */
  lastServiceDate: Date | null;
  /** The pet's coat condition, used to look up the coat-based interval. */
  coat?: string | null;
  /** The pet's per-pet rebooking interval override, in weeks. */
  rebookIntervalWeeks?: number | null;
  /** The groomer's `serviceIntervalDays`, used only when the coat is unmapped. */
  fallbackIntervalDays?: number | null;
}

/** PURE: parse a Date-or-string into a valid Date, or null. */
function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute the Next_Visit_Date shown on a Digital Pet Card.
 *
 * Pure function (no I/O, no globals). Rules, in order:
 *  1. A valid stored `nextDueAt` wins (Requirement 5.1).
 *  2. No last completed service → `null` (Requirement 5.3).
 *  3. A known coat or a positive per-pet override → last service plus the
 *     Coat_Interval via {@link computeNextDueAt} (Requirement 5.2).
 *  4. Otherwise → last service plus `fallbackIntervalDays` days when that is a
 *     positive number, else the 6-week fallback interval (Requirement 5.5).
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.5_
 */
export function computeNextRecommendedDate(
  input: NextRecommendedDateInput
): Date | null {
  const { nextDueAt, lastServiceDate, coat, rebookIntervalWeeks, fallbackIntervalDays } =
    input;

  const stored = toValidDate(nextDueAt);
  if (stored) return stored;

  if (!lastServiceDate) return null;

  const hasOverride =
    typeof rebookIntervalWeeks === 'number' &&
    Number.isFinite(rebookIntervalWeeks) &&
    rebookIntervalWeeks > 0;

  if (isKnownCoat(coat) || hasOverride) {
    return computeNextDueAt(lastServiceDate, coat, rebookIntervalWeeks);
  }

  if (
    typeof fallbackIntervalDays === 'number' &&
    Number.isFinite(fallbackIntervalDays) &&
    fallbackIntervalDays > 0
  ) {
    const next = new Date(lastServiceDate.getTime());
    next.setDate(next.getDate() + fallbackIntervalDays);
    return next;
  }

  return computeNextDueAt(lastServiceDate, coat, null);
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
  /** Stored next-due date, set when an appointment is completed. */
  nextDueAt?: Date | string | null;
  /** Per-pet rebooking interval override, in weeks. */
  rebookIntervalWeeks?: number | null;
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
  /**
   * The groomer's `serviceIntervalDays`, used only when the pet's coat cannot
   * be mapped to an interval and there is no per-pet override.
   */
  fallbackIntervalDays?: number | null;
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
 *  - computes the next recommended date from the pet's stored `nextDueAt`, or
 *    the most recent completed service date + the pet's Coat_Interval (via
 *    {@link computeNextRecommendedDate}),
 *  - builds `shareableUrl` as `${appBaseUrl}/pet-card/${cardId}`.
 *
 * @param input The loaded pet, service history, branding, fallback interval, and base URL.
 * @returns The `PetCardData` plus a `shareableUrl`.
 */
export function assemblePetCard(input: AssemblePetCardInput): AssembledPetCard {
  const { cardId, pet, serviceHistory, branding, fallbackIntervalDays, appBaseUrl } =
    input;

  const trimmedHistory = serviceHistory.slice(0, MAX_SERVICE_HISTORY_ENTRIES);

  const lastServiceDate =
    trimmedHistory.length > 0 ? new Date(trimmedHistory[0].date) : null;
  const nextRecommendedDate = computeNextRecommendedDate({
    nextDueAt: pet.nextDueAt,
    lastServiceDate,
    coat: pet.coatCondition,
    rebookIntervalWeeks: pet.rebookIntervalWeeks,
    fallbackIntervalDays,
  });

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
