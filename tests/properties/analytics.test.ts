import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeNoShowRate } from '@/lib/analytics/metrics';
import type { AppointmentLike } from '@/lib/analytics/metrics';
import type { AppointmentStatus } from '@/types';

/**
 * Feature: pawport, Property 12: Analytics no-show rate calculation
 *
 * For any set of appointments and a fixed `now`, the no-show rate SHALL equal
 *   round1( (# appointments where scheduledDate < now
 *             AND status not in {completed, cancelled}) / total * 100 )
 * and SHALL be 0 for an empty set.
 *
 * The oracle below is implemented independently of the production code so the
 * property genuinely cross-checks `computeNoShowRate`.
 *
 * Validates: Requirements 16.1
 */

const STATUSES: AppointmentStatus[] = [
  'upcoming',
  'in-progress',
  'completed',
  'cancelled',
];

/** Fixed reference instant appointments are compared against. */
const NOW = new Date('2024-06-15T12:00:00.000Z');

/** Independent oracle for the expected no-show rate. */
function expectedNoShowRate(
  appointments: ReadonlyArray<AppointmentLike>,
  now: Date
): number {
  const total = appointments.length;
  if (total === 0) {
    return 0;
  }
  let noShow = 0;
  for (const appt of appointments) {
    const isPast = appt.scheduledDate.getTime() < now.getTime();
    const excluded = appt.status === 'completed' || appt.status === 'cancelled';
    if (isPast && !excluded) {
      noShow += 1;
    }
  }
  // Round to one decimal place, independently of the production helper.
  return Number(((noShow / total) * 100).toFixed(1));
}

/**
 * An appointment generator with dates spread on BOTH sides of NOW so that the
 * "scheduledDate < now" branch is exercised in both directions across runs.
 */
const appointmentArb: fc.Arbitrary<AppointmentLike> = fc.record({
  status: fc.constantFrom(...STATUSES),
  scheduledDate: fc
    // Offsets in milliseconds spanning roughly +/- 60 days around NOW.
    .integer({ min: -60 * 24 * 60 * 60 * 1000, max: 60 * 24 * 60 * 60 * 1000 })
    .map((offset) => new Date(NOW.getTime() + offset)),
});

describe('Feature: pawport, Property 12: Analytics no-show rate calculation', () => {
  it('matches the independent oracle for arbitrary appointment arrays', () => {
    fc.assert(
      fc.property(fc.array(appointmentArb), (appointments) => {
        expect(computeNoShowRate(appointments, NOW)).toBe(
          expectedNoShowRate(appointments, NOW)
        );
      }),
      { numRuns: 200 }
    );
  });

  it('returns 0 for an empty array', () => {
    expect(computeNoShowRate([], NOW)).toBe(0);
    expect(expectedNoShowRate([], NOW)).toBe(0);
  });
});
