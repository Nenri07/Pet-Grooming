/**
 * Completion sets `nextDueAt` from the coat (plan-claims-audit, task 10.5).
 *
 * The pure `computeNextDueAt` is checked against every coat interval, the
 * per-pet override rule and the unknown-coat fallback. A source-text guard
 * then confirms the `completed` branch of `updateAppointmentStatus` keeps
 * using that rule to set `lastGroomAt` and `nextDueAt`.
 *
 * _Requirements: 5.4_
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COAT_INTERVAL_WEEKS, computeNextDueAt } from '@/lib/rebooking/interval';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const groomedAt = new Date('2025-03-10T15:00:00.000Z');
const plusWeeks = (weeks: number) => new Date(groomedAt.getTime() + weeks * WEEK_MS);

describe('computeNextDueAt', () => {
  it('uses the documented coat intervals', () => {
    expect(COAT_INTERVAL_WEEKS).toEqual({
      smooth: 6,
      double: 8,
      wire: 6,
      curly: 5,
      long: 5,
      matted: 4,
    });
  });

  it.each(Object.entries(COAT_INTERVAL_WEEKS))(
    'coat "%s" is due %i weeks after the groom',
    (coat, weeks) => {
      expect(computeNextDueAt(groomedAt, coat, undefined)).toEqual(plusWeeks(weeks));
    }
  );

  it('a positive per-pet override wins over the coat default', () => {
    expect(computeNextDueAt(groomedAt, 'double', 3)).toEqual(plusWeeks(3));
    expect(computeNextDueAt(groomedAt, 'matted', 3)).toEqual(plusWeeks(3));
  });

  it('an unknown or missing coat falls back to 6 weeks', () => {
    expect(computeNextDueAt(groomedAt, 'fluffy', undefined)).toEqual(plusWeeks(6));
    expect(computeNextDueAt(groomedAt, 'toString', undefined)).toEqual(plusWeeks(6));
    expect(computeNextDueAt(groomedAt, undefined, undefined)).toEqual(plusWeeks(6));
    expect(computeNextDueAt(groomedAt, null, null)).toEqual(plusWeeks(6));
  });

  it.each([0, -1, Number.NaN])('ignores a non-positive override (%s)', (override) => {
    expect(computeNextDueAt(groomedAt, 'double', override)).toEqual(plusWeeks(8));
  });

  it('does not mutate the groom date', () => {
    const input = new Date(groomedAt);
    computeNextDueAt(input, 'curly', undefined);
    expect(input).toEqual(groomedAt);
  });
});

describe('updateAppointmentStatus completion path (source guard)', () => {
  const source = readFileSync(
    resolve(__dirname, '../src/actions/appointments.ts'),
    'utf8'
  );

  // Isolate the body of updateAppointmentStatus, then the `completed` block
  // that touches the pet's rebooking dates.
  const fnStart = source.indexOf('updateAppointmentStatus');
  const fnBody = source.slice(fnStart);
  const completedBlocks = fnBody
    .split(/if \(newStatus === 'completed'\)/)
    .slice(1);
  const rebookBlock = completedBlocks.find((b) => b.includes('computeNextDueAt')) ?? '';

  it('defines updateAppointmentStatus', () => {
    expect(fnStart).toBeGreaterThanOrEqual(0);
  });

  it('calls computeNextDueAt with the pet coat and override in the completed branch', () => {
    expect(rebookBlock).not.toBe('');
    expect(rebookBlock).toMatch(/import\('@\/lib\/rebooking(\/interval)?'\)/);
    expect(rebookBlock).toMatch(/select\('[^']*coatCondition[^']*rebookIntervalWeeks[^']*'\)/);
    expect(rebookBlock).toMatch(
      /computeNextDueAt\(\s*groomedAt,\s*\w+\.coatCondition,\s*\w+\.rebookIntervalWeeks\s*\)/
    );
  });

  it('sets lastGroomAt and nextDueAt on the pet', () => {
    expect(rebookBlock).toMatch(/\$set:\s*\{\s*lastGroomAt:\s*groomedAt,\s*nextDueAt\s*\}/);
  });
});
