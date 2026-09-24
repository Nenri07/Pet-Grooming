import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { AppointmentStatus } from '@/types';
import { canTransition, VALID_TRANSITIONS } from '@/lib/appointments/status';

/**
 * Feature: pawport, Property 5: Appointment status transitions are valid
 *
 * For any appointment with a current status, any attempted transition SHALL
 * only succeed if it is in the valid set:
 *   { upcoming -> in-progress, upcoming -> cancelled,
 *     in-progress -> completed, in-progress -> cancelled }.
 * All other transitions SHALL be rejected.
 *
 * Validates: Requirements 12.1
 */

const STATUSES: AppointmentStatus[] = [
  'upcoming',
  'in-progress',
  'completed',
  'cancelled',
];

const statusArb = fc.constantFrom(...STATUSES);

describe('Feature: pawport, Property 5: Appointment status transitions are valid', () => {
  it('canTransition is equivalent to the VALID_TRANSITIONS table for every (from, to) pair', () => {
    fc.assert(
      fc.property(statusArb, statusArb, (from, to) => {
        expect(canTransition(from, to)).toBe(VALID_TRANSITIONS[from].includes(to));
      }),
      { numRuns: 100 }
    );
  });

  it('accepts each of the four valid transitions (positive cases)', () => {
    const validTransitions: Array<[AppointmentStatus, AppointmentStatus]> = [
      ['upcoming', 'in-progress'],
      ['upcoming', 'cancelled'],
      ['in-progress', 'completed'],
      ['in-progress', 'cancelled'],
    ];

    for (const [from, to] of validTransitions) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('rejects every transition out of terminal states (completed, cancelled)', () => {
    const terminalArb = fc.constantFrom<AppointmentStatus>('completed', 'cancelled');

    fc.assert(
      fc.property(terminalArb, statusArb, (from, to) => {
        expect(canTransition(from, to)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects all no-op self-transitions (from === to)', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        expect(canTransition(status, status)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
