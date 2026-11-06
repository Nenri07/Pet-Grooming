/**
 * Next visit property tests (plan-claims-audit, Property 6).
 *
 * Feature: plan-claims-audit, Property 6: Next visit follows the pet
 *
 * The pure `computeNextRecommendedDate(input)` picks the Next_Visit_Date shown
 * on a Digital Pet Card:
 *  1. a valid stored `nextDueAt` wins;
 *  2. no completed service -> null;
 *  3. a known coat (or positive override) -> last service + Coat_Interval weeks,
 *     independent of the groomer's `fallbackIntervalDays`;
 *  4. otherwise a positive `fallbackIntervalDays` (local calendar days), else
 *     the 6-week fallback.
 *
 * Only pure modules are imported.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.5**
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { computeNextRecommendedDate } from '@/lib/pet-card/assemble';
import {
  COAT_INTERVAL_WEEKS,
  resolveIntervalWeeks,
} from '@/lib/rebooking/interval';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RUNS = { numRuns: 200 };
const KNOWN_COATS = Object.keys(COAT_INTERVAL_WEEKS);

/** Valid dates between 2000 and 2040. */
const dateArb = fc
  .integer({
    min: Date.UTC(2000, 0, 1),
    max: Date.UTC(2040, 0, 1),
  })
  .map((ms) => new Date(ms));

const knownCoatArb = fc.constantFrom(...KNOWN_COATS);

/** Coats with no entry in COAT_INTERVAL_WEEKS (incl. inherited keys). */
const unknownCoatArb = fc.oneof(
  fc.constantFrom<string | null | undefined>(
    null,
    undefined,
    '',
    'toString',
    'constructor',
    '__proto__',
    'fluffy',
    'Double'
  ),
  fc.string().filter((s) => !KNOWN_COATS.includes(s))
);

/** Any coat value. */
const anyCoatArb = fc.oneof(knownCoatArb, unknownCoatArb);

const positiveOverrideArb = fc.oneof(
  fc.integer({ min: 1, max: 52 }),
  fc.double({ min: 0.5, max: 52, noNaN: true })
);

/** Overrides that are not positive finite numbers. */
const nonPositiveOverrideArb = fc.constantFrom<number | null | undefined>(
  null,
  undefined,
  0,
  -1,
  -6,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY
);

const anyOverrideArb = fc.oneof(positiveOverrideArb, nonPositiveOverrideArb);

const positiveFallbackArb = fc.integer({ min: 1, max: 3650 });

const nonPositiveFallbackArb = fc.constantFrom<number | null | undefined>(
  null,
  undefined,
  0,
  -1,
  -42,
  Number.NaN,
  Number.POSITIVE_INFINITY
);

const anyFallbackArb = fc.oneof(
  fc.constantFrom<number | null | undefined>(42, 1, 365, null),
  positiveFallbackArb,
  nonPositiveFallbackArb
);

/** `nextDueAt` values that count as unset. */
const unsetNextDueArb = fc.constantFrom<Date | string | null | undefined>(
  undefined,
  null,
  '',
  'not-a-date',
  new Date(Number.NaN)
);

/**
 * Oracle for "+N weeks" in fixed milliseconds. Goes through `new Date()` so a
 * fractional override is truncated to whole ms exactly like the implementation.
 */
function addWeeksMs(d: Date, weeks: number): number {
  return new Date(d.getTime() + weeks * WEEK_MS).getTime();
}

/** Oracle for "+N local calendar days" (matches the implementation's setDate). */
function addLocalDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

describe('Feature: plan-claims-audit, Property 6: Next visit follows the pet', () => {
  it('a valid stored nextDueAt (Date or ISO string) always wins', () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.boolean(),
        fc.option(dateArb, { nil: null }),
        anyCoatArb,
        anyOverrideArb,
        anyFallbackArb,
        (due, asString, last, coat, override, fallback) => {
          const result = computeNextRecommendedDate({
            nextDueAt: asString ? due.toISOString() : due,
            lastServiceDate: last,
            coat,
            rebookIntervalWeeks: override,
            fallbackIntervalDays: fallback,
          });
          expect(result).not.toBeNull();
          expect(result!.getTime()).toBe(due.getTime());
        }
      ),
      RUNS
    );
  });

  it('no nextDueAt and no completed service -> null', () => {
    fc.assert(
      fc.property(
        unsetNextDueArb,
        anyCoatArb,
        anyOverrideArb,
        anyFallbackArb,
        (due, coat, override, fallback) => {
          expect(
            computeNextRecommendedDate({
              nextDueAt: due,
              lastServiceDate: null,
              coat,
              rebookIntervalWeeks: override,
              fallbackIntervalDays: fallback,
            })
          ).toBeNull();
        }
      ),
      RUNS
    );
  });

  it('known coat -> last service + coat interval weeks, independent of fallbackIntervalDays', () => {
    fc.assert(
      fc.property(
        unsetNextDueArb,
        dateArb,
        knownCoatArb,
        anyOverrideArb,
        fc.array(anyFallbackArb, { minLength: 1, maxLength: 5 }),
        (due, last, coat, override, fallbacks) => {
          const expected = addWeeksMs(last, resolveIntervalWeeks(coat, override));
          for (const fallback of [42, 1, 365, null, ...fallbacks]) {
            const result = computeNextRecommendedDate({
              nextDueAt: due,
              lastServiceDate: last,
              coat,
              rebookIntervalWeeks: override,
              fallbackIntervalDays: fallback,
            });
            expect(result).not.toBeNull();
            expect(result!.getTime()).toBe(expected);
          }
        }
      ),
      RUNS
    );
  });

  it('unknown coat with a positive override -> last service + override weeks', () => {
    fc.assert(
      fc.property(
        unsetNextDueArb,
        dateArb,
        unknownCoatArb,
        positiveOverrideArb,
        anyFallbackArb,
        (due, last, coat, override, fallback) => {
          const result = computeNextRecommendedDate({
            nextDueAt: due,
            lastServiceDate: last,
            coat,
            rebookIntervalWeeks: override,
            fallbackIntervalDays: fallback,
          });
          expect(result!.getTime()).toBe(addWeeksMs(last, override));
        }
      ),
      RUNS
    );
  });

  it('unknown coat, no positive override -> positive fallbackIntervalDays, else 6 weeks', () => {
    fc.assert(
      fc.property(
        unsetNextDueArb,
        dateArb,
        unknownCoatArb,
        nonPositiveOverrideArb,
        fc.oneof(positiveFallbackArb, nonPositiveFallbackArb),
        (due, last, coat, override, fallback) => {
          const result = computeNextRecommendedDate({
            nextDueAt: due,
            lastServiceDate: last,
            coat,
            rebookIntervalWeeks: override,
            fallbackIntervalDays: fallback,
          });
          const usesFallback =
            typeof fallback === 'number' &&
            Number.isFinite(fallback) &&
            fallback > 0;
          const expected = usesFallback
            ? addLocalDays(last, fallback as number).getTime()
            : last.getTime() + 6 * WEEK_MS;
          expect(result!.getTime()).toBe(expected);
        }
      ),
      RUNS
    );
  });
});

describe('computeNextRecommendedDate examples', () => {
  const last = new Date('2025-03-01T15:00:00.000Z');

  it('double coat -> 8 weeks', () => {
    const r = computeNextRecommendedDate({ lastServiceDate: last, coat: 'double' });
    expect(r!.getTime()).toBe(last.getTime() + 8 * WEEK_MS);
  });

  it('matted coat -> 4 weeks', () => {
    const r = computeNextRecommendedDate({
      lastServiceDate: last,
      coat: 'matted',
      fallbackIntervalDays: 42,
    });
    expect(r!.getTime()).toBe(last.getTime() + 4 * WEEK_MS);
  });

  it('curly coat with override 3 -> 3 weeks', () => {
    const r = computeNextRecommendedDate({
      lastServiceDate: last,
      coat: 'curly',
      rebookIntervalWeeks: 3,
    });
    expect(r!.getTime()).toBe(last.getTime() + 3 * WEEK_MS);
  });

  it('unknown coat with fallback 42 -> 42 days', () => {
    const r = computeNextRecommendedDate({
      lastServiceDate: last,
      coat: 'mystery',
      fallbackIntervalDays: 42,
    });
    expect(r!.getTime()).toBe(addLocalDays(last, 42).getTime());
  });

  it('no grooms -> null', () => {
    expect(
      computeNextRecommendedDate({
        lastServiceDate: null,
        coat: 'double',
        fallbackIntervalDays: 42,
      })
    ).toBeNull();
  });

  it('stored nextDueAt wins over the coat rule', () => {
    const due = new Date('2025-06-01T00:00:00.000Z');
    const r = computeNextRecommendedDate({
      nextDueAt: due,
      lastServiceDate: last,
      coat: 'double',
    });
    expect(r!.getTime()).toBe(due.getTime());
  });
});
