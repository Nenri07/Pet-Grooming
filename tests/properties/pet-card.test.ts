import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  assemblePetCard,
  MAX_SERVICE_HISTORY_ENTRIES,
} from '@/lib/pet-card/assemble';
import type {
  AppointmentStatus,
  CoatCondition,
  ServiceHistoryEntry,
  Temperament,
  WeightUnit,
} from '@/types';

const TEMPERAMENTS: readonly Temperament[] = [
  'calm',
  'nervous',
  'aggressive',
  'friendly',
] as const;

const COAT_CONDITIONS: readonly CoatCondition[] = [
  'smooth',
  'double',
  'wire',
  'curly',
  'long',
  'matted',
] as const;

const WEIGHT_UNITS: readonly WeightUnit[] = ['lbs', 'kg'] as const;

const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'upcoming',
  'in-progress',
  'completed',
  'cancelled',
] as const;

/** A fixed, valid public app base URL used to build shareable links. */
const APP_BASE_URL = 'https://example.com';

/** Non-empty printable text, trimmed to guarantee a non-empty result. */
const nonEmptyText = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** A single completed service-history entry. */
const serviceHistoryEntryArb: fc.Arbitrary<ServiceHistoryEntry> = fc.record({
  date: fc.date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2035-12-31T00:00:00.000Z'),
    noInvalidDate: true,
  }),
  serviceName: nonEmptyText,
  notes: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  status: fc.constantFrom(...APPOINTMENT_STATUSES),
});

/** A complete pet (all required fields populated with valid values). */
const petArb = fc.record({
  name: nonEmptyText,
  photoUrl: fc.option(fc.webUrl(), { nil: undefined }),
  breed: nonEmptyText,
  weight: fc.integer({ min: 1, max: 200 }),
  weightUnit: fc.constantFrom(...WEIGHT_UNITS),
  age: fc.integer({ min: 0, max: 30 }),
  temperament: fc.constantFrom(...TEMPERAMENTS),
  coatCondition: fc.constantFrom(...COAT_CONDITIONS),
  specialFlags: fc.array(nonEmptyText, { maxLength: 4 }),
  notes: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Feature: pawport, Property 11: Digital Pet Card data completeness
//
// For any pet with a complete profile (all required fields populated) and at
// least one completed appointment, the assembled Digital Pet Card data SHALL
// contain: pet name, breed, weight, age, temperament, coat condition, at least
// one service history entry (up to 5), groomer business name, and a valid
// shareable URL.
//
// Validates: Requirements 17.1
// ---------------------------------------------------------------------------
describe('Feature: pawport, Property 11: Digital Pet Card data completeness', () => {
  it('assembles a complete card with all required fields and a valid shareable URL', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // cardId
        petArb, // complete pet profile
        // At least one completed service entry (1..8), so the up-to-5 cap is exercised.
        fc.array(serviceHistoryEntryArb, { minLength: 1, maxLength: 8 }),
        nonEmptyText, // branding.businessName (non-empty)
        fc.integer({ min: 7, max: 90 }), // intervalDays
        (cardId, pet, serviceHistory, businessName, intervalDays) => {
          const card = assemblePetCard({
            cardId,
            pet,
            serviceHistory,
            branding: { businessName },
            intervalDays,
            appBaseUrl: APP_BASE_URL,
          });

          // Pet identity fields equal the inputs.
          expect(card.name).toBe(pet.name);
          expect(card.breed).toBe(pet.breed);
          expect(card.weight).toBe(pet.weight);
          expect(card.age).toBe(pet.age);
          expect(card.temperament).toBe(pet.temperament);
          expect(card.coatCondition).toBe(pet.coatCondition);

          // At least one service-history entry, capped at 5.
          expect(card.serviceHistory.length).toBeGreaterThanOrEqual(1);
          expect(card.serviceHistory.length).toBeLessThanOrEqual(
            MAX_SERVICE_HISTORY_ENTRIES
          );

          // Groomer business name is present and non-empty.
          expect(card.branding.businessName.length).toBeGreaterThan(0);

          // Shareable URL matches the expected shape and is a valid URL.
          const expectedUrl = `${APP_BASE_URL}/pet-card/${cardId}`;
          expect(card.shareableUrl).toBe(expectedUrl);
          expect(() => new URL(card.shareableUrl)).not.toThrow();
        }
      ),
      { numRuns: 200 }
    );
  });
});
