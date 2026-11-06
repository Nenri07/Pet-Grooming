/**
 * Rebooking nudge throttle property tests (plan-claims-audit, Property 5).
 *
 * Feature: plan-claims-audit, Property 5: One nudge per due cycle
 *
 * `shouldNudge(lastNudgedAt, nextDueAt, now)` is pure. The sweep only looks at
 * pets with `nextDueAt <= now + 7 days`, so every sweep time is inside the due
 * window (`now >= nextDueAt - 7 days`). Each successful nudge sets
 * `lastNudgedAt = now`. Under those rules a pet gets exactly one nudge while
 * `nextDueAt` is unchanged, and becomes eligible again once completing an
 * appointment moves `nextDueAt` forward by a coat interval.
 *
 * `src/lib/rebooking/nudges.ts` only imports `nanoid` at the top level; all DB
 * modules are dynamic imports inside `runRebookNudges`, so no mocks are needed.
 *
 * **Validates: Requirements 4.3**
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { shouldNudge } from '@/lib/rebooking/nudges';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WINDOW_MS = 7 * DAY_MS;
const BASE_MS = Date.parse('2025-06-15T12:00:00.000Z');
const YEAR_MS = 365 * DAY_MS;

/** Any due date within a few years of the base date. */
const arbDueMs = fc.integer({ min: BASE_MS - 3 * YEAR_MS, max: BASE_MS + 3 * YEAR_MS });

/**
 * Sweep times for a pet, as non-negative offsets from the window start
 * (`nextDueAt - 7 days`). Up to 60 days overdue, since overdue pets stay in
 * the sweep until they are booked.
 */
const arbSweepOffsets = fc.array(fc.integer({ min: 0, max: WINDOW_MS + 60 * DAY_MS }), {
  minLength: 1,
  maxLength: 30,
});

/** Starting state: never nudged, or nudged in an earlier cycle. */
function arbStartNudge(dueMs: number): fc.Arbitrary<number | null> {
  return fc.oneof(
    fc.constant(null),
    fc.integer({ min: 1, max: 2 * YEAR_MS }).map((before) => dueMs - WINDOW_MS - before)
  );
}

/** Strictly increasing sweep times inside the due window. */
function sweepTimes(dueMs: number, offsets: number[]): number[] {
  const sorted = [...new Set(offsets)].sort((a, b) => a - b);
  return sorted.map((o) => dueMs - WINDOW_MS + o);
}

/** Simulate sweeps; returns the updated lastNudgedAt and the nudge count. */
function simulate(
  dueMs: number,
  times: number[],
  start: number | null
): { last: number | null; sent: number } {
  let last = start;
  let sent = 0;
  for (const t of times) {
    const ok = shouldNudge(last === null ? null : new Date(last), new Date(dueMs), new Date(t));
    if (ok) {
      sent += 1;
      last = t;
    }
  }
  return { last, sent };
}

describe('Feature: plan-claims-audit, Property 5: One nudge per due cycle', () => {
  it('sends exactly one nudge per cycle while nextDueAt is unchanged', () => {
    fc.assert(
      fc.property(
        arbDueMs.chain((dueMs) =>
          fc.tuple(fc.constant(dueMs), arbSweepOffsets, arbStartNudge(dueMs))
        ),
        ([dueMs, offsets, start]) => {
          const { sent, last } = simulate(dueMs, sweepTimes(dueMs, offsets), start);
          expect(sent).toBe(1);
          // The nudge recorded belongs to the current window.
          expect(last).not.toBeNull();
          expect(last as number).toBeGreaterThanOrEqual(dueMs - WINDOW_MS);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('becomes eligible again when completion moves nextDueAt forward by a coat interval', () => {
    fc.assert(
      fc.property(
        arbDueMs.chain((dueMs) =>
          fc.tuple(
            fc.constant(dueMs),
            arbSweepOffsets,
            arbStartNudge(dueMs),
            // Appointment completed some time after the nudge (0..60 days).
            fc.integer({ min: 0, max: 60 * DAY_MS }),
            // Coat interval of at least 4 weeks.
            fc.integer({ min: 4, max: 16 }),
            fc.array(fc.integer({ min: 0, max: WINDOW_MS + 60 * DAY_MS }), {
              minLength: 1,
              maxLength: 30,
            })
          )
        ),
        ([dueMs, offsets, start, completeAfter, weeks, nextOffsets]) => {
          const first = simulate(dueMs, sweepTimes(dueMs, offsets), start);
          expect(first.sent).toBe(1);
          const nudgedAt = first.last as number;

          // Completion sets nextDueAt = completion + coat interval.
          const completedAt = nudgedAt + completeAfter;
          const nextDueMs = completedAt + weeks * WEEK_MS;

          // New cycle: eligible at the first sweep of the new window...
          const windowOpen = nextDueMs - WINDOW_MS;
          expect(shouldNudge(new Date(nudgedAt), new Date(nextDueMs), new Date(windowOpen))).toBe(
            true
          );

          // ...and again exactly one nudge across the new cycle's sweeps.
          const second = simulate(nextDueMs, sweepTimes(nextDueMs, nextOffsets), nudgedAt);
          expect(second.sent).toBe(1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('never-nudged pets are eligible', () => {
    fc.assert(
      fc.property(arbDueMs, fc.integer({ min: 0, max: WINDOW_MS + 60 * DAY_MS }), (dueMs, o) => {
        const now = new Date(dueMs - WINDOW_MS + o);
        expect(shouldNudge(null, new Date(dueMs), now)).toBe(true);
        expect(shouldNudge(undefined, new Date(dueMs), now)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('a pet nudged inside the current window is not eligible', () => {
    fc.assert(
      fc.property(
        arbDueMs,
        fc.integer({ min: 0, max: WINDOW_MS + 60 * DAY_MS }),
        fc.integer({ min: 0, max: 30 * DAY_MS }),
        (dueMs, nudgeOffset, later) => {
          const nudgedAt = dueMs - WINDOW_MS + nudgeOffset;
          const now = new Date(nudgedAt + later);
          expect(shouldNudge(new Date(nudgedAt), new Date(dueMs), now)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles the window-open boundary', () => {
    const due = new Date(BASE_MS);
    const open = BASE_MS - WINDOW_MS;
    expect(shouldNudge(new Date(open - 1), due)).toBe(true);
    expect(shouldNudge(new Date(open), due)).toBe(false);
    expect(shouldNudge(new Date(open + 1), due)).toBe(false);
  });
});
