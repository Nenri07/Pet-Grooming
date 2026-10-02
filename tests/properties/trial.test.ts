import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { toZonedTime } from 'date-fns-tz';
import { computeTrialDeadline, trialDaysRemaining } from '@/lib/billing/trial';

// Feature: billing-trial-and-payments
//
// Property-based tests for the trial-math pure core (`src/lib/billing/trial.ts`).
// These cover the two correctness properties from the design's Testing Strategy:
//   - Property 2: computeTrialDeadline lands on noon local wall-clock, on the
//     start's local calendar date + 14 days, across supported IANA timezones.
//   - Property 3: trialDaysRemaining is a non-negative integer, 0 once the
//     deadline has passed, and monotonic non-increasing as `now` advances.
//
// Assertions project the UTC deadline back into the target timezone with
// `date-fns-tz` v3 `toZonedTime`, matching the implementation.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRIAL_LENGTH_DAYS = 14;

// Real IANA zones covering: UTC, US DST, a +05:00 non-DST zone, a southern-
// hemisphere DST zone (DST offset opposite to the northern ones), and the
// extreme +14:00 zone that is a full day ahead of UTC.
const SUPPORTED_TIMEZONES = [
  'UTC',
  'America/New_York',
  'Asia/Karachi',
  'Australia/Sydney',
  'Pacific/Kiritimati',
] as const;

// Arbitrary start instants spread across ~1980..2037 so the generator exercises
// many different DST states, leap years, and month/year rollovers for the +14d
// calendar advance.
const startInstantArb = fc
  .integer({ min: 0, max: 2_147_483_647 }) // seconds in the classic 1970..2038 range
  .map((secs) => new Date(secs * 1000));

const timezoneArb = fc.constantFrom(...SUPPORTED_TIMEZONES);

/**
 * Read the local wall-clock calendar parts of an absolute instant *as observed
 * in `timezone`*. We go through `Intl.DateTimeFormat` (the same engine the
 * implementation validates against) rather than relying on the host's local
 * getters, so the assertions are independent of the machine the tests run on.
 */
function wallClockParts(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Intl renders midnight as hour "24" in some engines; normalize to 0.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'), // 1-12
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

describe('Feature: billing-trial-and-payments, Property 2: computeTrialDeadline is noon-local on day 14', () => {
  it('lands on 12:00:00 local wall-clock, on start-local-date + 14 days, for every supported tz', () => {
    fc.assert(
      fc.property(startInstantArb, timezoneArb, (startedAt, timezone) => {
        const deadline = computeTrialDeadline(startedAt, timezone);

        // Project both instants back into the target zone and compare the
        // local wall clock the implementation claims to pin.
        const start = wallClockParts(startedAt, timezone);
        const end = wallClockParts(deadline, timezone);

        // Noon local, zeroed minutes/seconds.
        expect(end.hour).toBe(12);
        expect(end.minute).toBe(0);
        expect(end.second).toBe(0);

        // Local calendar date is exactly the start's local date + 14 days.
        // Compare via a UTC-anchored date built from the local Y/M/D parts, so
        // month/year rollovers are handled by Date arithmetic.
        const startLocalMidnightUTC = Date.UTC(start.year, start.month - 1, start.day);
        const endLocalMidnightUTC = Date.UTC(end.year, end.month - 1, end.day);
        const dayDelta = Math.round((endLocalMidnightUTC - startLocalMidnightUTC) / MS_PER_DAY);
        expect(dayDelta).toBe(TRIAL_LENGTH_DAYS);
      }),
      { numRuns: 300 }
    );
  });

  it('also matches when projecting back with toZonedTime (implementation parity)', () => {
    fc.assert(
      fc.property(startInstantArb, timezoneArb, (startedAt, timezone) => {
        const deadline = computeTrialDeadline(startedAt, timezone);
        // toZonedTime returns a Date whose host-local getters express the target
        // zone's wall clock — the exact round-trip the implementation performs.
        const zoned = toZonedTime(deadline, timezone);
        expect(zoned.getHours()).toBe(12);
        expect(zoned.getMinutes()).toBe(0);
        expect(zoned.getSeconds()).toBe(0);
      }),
      { numRuns: 200 }
    );
  });

  it('DST boundary: a start just before US spring-forward still lands on noon local', () => {
    // 2024-03-10 ~02:00 America/New_York is the spring-forward gap (02:00->03:00).
    // A start the evening before should still produce a noon-local deadline 14
    // calendar days later, despite the intervening 23-hour DST day.
    const tz = 'America/New_York';
    // 2024-03-09 20:30 EST = 2024-03-10T01:30:00Z.
    const startedAt = new Date('2024-03-10T01:30:00.000Z');
    const deadline = computeTrialDeadline(startedAt, tz);

    const start = wallClockParts(startedAt, tz);
    const end = wallClockParts(deadline, tz);

    expect(end.hour).toBe(12);
    expect(end.minute).toBe(0);
    expect(end.second).toBe(0);

    const startLocalMidnightUTC = Date.UTC(start.year, start.month - 1, start.day);
    const endLocalMidnightUTC = Date.UTC(end.year, end.month - 1, end.day);
    expect(Math.round((endLocalMidnightUTC - startLocalMidnightUTC) / MS_PER_DAY)).toBe(
      TRIAL_LENGTH_DAYS
    );
  });

  it('DST boundary: a start just before Australia/Sydney DST transition still lands on noon local', () => {
    // Southern-hemisphere DST runs opposite the US; 2024-04-07 is a fall-back
    // day in Sydney. Verify the +14d deadline still pins to noon local there.
    const tz = 'Australia/Sydney';
    const startedAt = new Date('2024-04-06T15:30:00.000Z');
    const deadline = computeTrialDeadline(startedAt, tz);
    const zoned = toZonedTime(deadline, tz);
    expect(zoned.getHours()).toBe(12);
    expect(zoned.getMinutes()).toBe(0);
    expect(zoned.getSeconds()).toBe(0);
  });
});

describe('Feature: billing-trial-and-payments, Property 3: trialDaysRemaining is non-negative and monotonic', () => {
  const deadlineArb = startInstantArb; // reuse the wide instant range as deadlines

  it('is always a non-negative integer, and 0 once now >= deadline', () => {
    fc.assert(
      fc.property(startInstantArb, deadlineArb, timezoneArb, (now, deadline, timezone) => {
        const remaining = trialDaysRemaining(now, deadline, timezone);

        expect(Number.isInteger(remaining)).toBe(true);
        expect(remaining).toBeGreaterThanOrEqual(0);

        if (now.getTime() >= deadline.getTime()) {
          expect(remaining).toBe(0);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('is monotonic non-increasing as now advances toward (and past) the deadline', () => {
    fc.assert(
      fc.property(
        startInstantArb,
        deadlineArb,
        fc.integer({ min: 0, max: 60 * MS_PER_DAY }), // non-negative gap: now1 <= now2
        timezoneArb,
        (now1, deadline, gapMs, timezone) => {
          const now2 = new Date(now1.getTime() + gapMs);
          const r1 = trialDaysRemaining(now1, deadline, timezone);
          const r2 = trialDaysRemaining(now2, deadline, timezone);
          // now1 <= now2  =>  remaining(now1) >= remaining(now2)
          expect(r1).toBeGreaterThanOrEqual(r2);
        }
      ),
      { numRuns: 300 }
    );
  });

  // --- Boundary examples (ceil semantics) ---

  it('now exactly at the deadline -> 0', () => {
    const deadline = new Date('2025-01-15T12:00:00.000Z');
    expect(trialDaysRemaining(deadline, deadline, 'UTC')).toBe(0);
  });

  it('now after the deadline -> 0', () => {
    const deadline = new Date('2025-01-15T12:00:00.000Z');
    const now = new Date('2025-01-20T12:00:00.000Z');
    expect(trialDaysRemaining(now, deadline, 'UTC')).toBe(0);
  });

  it('~2.3 days before the deadline -> 3 (rounds up)', () => {
    const deadline = new Date('2025-01-15T12:00:00.000Z');
    const now = new Date(deadline.getTime() - Math.round(2.3 * MS_PER_DAY));
    expect(trialDaysRemaining(now, deadline, 'UTC')).toBe(3);
  });

  it('just under 1 day remaining -> 1', () => {
    const deadline = new Date('2025-01-15T12:00:00.000Z');
    const now = new Date(deadline.getTime() - (MS_PER_DAY - 1000)); // 1 second shy of a full day
    expect(trialDaysRemaining(now, deadline, 'UTC')).toBe(1);
  });

  it('just under 3 days remaining -> 3 (the "3 days left" emphasize boundary)', () => {
    const deadline = new Date('2025-01-15T12:00:00.000Z');
    const now = new Date(deadline.getTime() - (3 * MS_PER_DAY - 1000));
    expect(trialDaysRemaining(now, deadline, 'UTC')).toBe(3);
  });

  it('exactly 3 full days remaining -> 3 (upper edge of the emphasize bucket)', () => {
    const deadline = new Date('2025-01-15T12:00:00.000Z');
    const now = new Date(deadline.getTime() - 3 * MS_PER_DAY);
    expect(trialDaysRemaining(now, deadline, 'UTC')).toBe(3);
  });
});
