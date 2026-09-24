/**
 * Property-based tests for the PURE availability core.
 *
 * Covers design.md Property 3 and Property 4 for the DB-free helpers exported
 * from `@/lib/calendar/availability`:
 *   - generateCandidateSlots — slot generation over recurring windows.
 *   - hasConflict          — half-open interval overlap against blocks.
 *
 * These tests are intentionally clock-independent: they exercise the pure core
 * directly rather than the DB-backed `getAvailableSlots` orchestrator, so they
 * never need a database or the current time.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  generateCandidateSlots,
  hasConflict,
  type AvailabilityWindowInput,
  type TimeBlock,
} from '@/lib/calendar/availability';
import type { TimeSlot } from '@/types';

const NUM_RUNS = 200;
const MS_PER_MINUTE = 60 * 1000;

// A fixed anchor day so generated dates stay in a small, deterministic range.
// 2024-06-01 is a Saturday; using UTC-agnostic local constructor is fine since
// all comparisons are relative within the same construction path.
const ANCHOR_YEAR = 2024;
const ANCHOR_MONTH = 5; // June (0-indexed)
const ANCHOR_DAY = 1;

/** Build a local Date at midnight for `ANCHOR_DAY + offset` days. */
function dayAt(offset: number): Date {
  return new Date(ANCHOR_YEAR, ANCHOR_MONTH, ANCHOR_DAY + offset, 0, 0, 0, 0);
}

/** Minutes-since-midnight (aligned to 15) -> "HH:mm". */
function toHHmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Arbitrary recurring window: dayOfWeek 0-6, start < end, both aligned to
 * 15-minute boundaries and within a single day.
 */
const windowArb: fc.Arbitrary<AvailabilityWindowInput> = fc
  .record({
    dayOfWeek: fc.integer({ min: 0, max: 6 }),
    // Slot indices in 15-min units; 0..95 covers 00:00..23:45.
    startIdx: fc.integer({ min: 0, max: 92 }),
    span: fc.integer({ min: 1, max: 8 }), // 15min .. 2h window span
  })
  .map(({ dayOfWeek, startIdx, span }) => {
    const endIdx = Math.min(startIdx + span, 95);
    return {
      dayOfWeek,
      startTime: toHHmm(startIdx * 15),
      endTime: toHHmm(endIdx * 15),
    };
  })
  // Guarantee start < end even after clamping.
  .filter((w) => w.startTime < w.endTime);

/** A small set of windows (bounded for speed). */
const windowsArb: fc.Arbitrary<AvailabilityWindowInput[]> = fc.array(windowArb, {
  minLength: 0,
  maxLength: 4,
});

/**
 * Arbitrary block within the anchored date range (0..4 days out). Start is a
 * random minute-of-day; end is start + a positive duration, kept within the
 * same conceptual few-day window.
 */
const blockArb: fc.Arbitrary<TimeBlock> = fc
  .record({
    dayOffset: fc.integer({ min: 0, max: 4 }),
    startMinute: fc.integer({ min: 0, max: 24 * 60 - 1 }),
    durationMinutes: fc.integer({ min: 1, max: 180 }),
  })
  .map(({ dayOffset, startMinute, durationMinutes }) => {
    const base = dayAt(dayOffset).getTime();
    const start = new Date(base + startMinute * MS_PER_MINUTE);
    const end = new Date(start.getTime() + durationMinutes * MS_PER_MINUTE);
    return { start, end };
  });

const blocksArb: fc.Arbitrary<TimeBlock[]> = fc.array(blockArb, {
  minLength: 0,
  maxLength: 6,
});

/** Service duration: 15..120 minutes. */
const serviceDurationArb: fc.Arbitrary<number> = fc.integer({ min: 15, max: 120 });

/**
 * A start/end date range spanning a few days, anchored to the fixed anchor.
 * Returns [startDate, endDate] with startDate <= endDate.
 */
const dateRangeArb: fc.Arbitrary<[Date, Date]> = fc
  .record({
    startOffset: fc.integer({ min: 0, max: 4 }),
    length: fc.integer({ min: 0, max: 4 }),
  })
  .map(({ startOffset, length }) => [dayAt(startOffset), dayAt(startOffset + length)] as [Date, Date]);

const scenarioArb = fc.record({
  windows: windowsArb,
  blocks: blocksArb,
  serviceDurationMinutes: serviceDurationArb,
  range: dateRangeArb,
});

describe('Feature: pawport, Property 3: Availability slots never overlap with blocked time', () => {
  it('every available slot has no conflict with any block', () => {
    fc.assert(
      fc.property(scenarioArb, ({ windows, blocks, serviceDurationMinutes, range }) => {
        const [startDate, endDate] = range;
        const slots: TimeSlot[] = generateCandidateSlots(
          windows,
          blocks,
          startDate,
          endDate,
          serviceDurationMinutes
        );

        for (const slot of slots) {
          if (slot.available === true) {
            // No available slot may overlap any blocked interval.
            expect(hasConflict(slot.start, slot.end, blocks)).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('Feature: pawport, Property 4: Availability slots respect service duration', () => {
  it('every candidate slot is exactly the requested service duration long', () => {
    fc.assert(
      fc.property(scenarioArb, ({ windows, blocks, serviceDurationMinutes, range }) => {
        const [startDate, endDate] = range;
        const slots: TimeSlot[] = generateCandidateSlots(
          windows,
          blocks,
          startDate,
          endDate,
          serviceDurationMinutes
        );

        const expectedMs = serviceDurationMinutes * MS_PER_MINUTE;
        for (const slot of slots) {
          const actualMs = slot.end.getTime() - slot.start.getTime();
          // Slot length is exactly (and therefore >=) the requested duration.
          expect(actualMs).toBe(expectedMs);
          expect(actualMs).toBeGreaterThanOrEqual(expectedMs);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
