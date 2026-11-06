/**
 * Message allowance property tests (plan-claims-audit, Property 7).
 *
 * Pure core only: `hasAllowance(used, included, topup)` decides whether an
 * optional client message (Fill My Day offer, rebook nudge, Inbox message) may
 * be sent. No DB, Redis or email provider.
 *
 * **Validates: Requirements 3.2, 4.4**
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { hasAllowance } from '@/lib/messaging/usage';

const countArb = fc.integer({ min: 0, max: 10_000 });

/** Allowance values that are not a finite non-negative number. */
const badAllowanceArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  fc.integer({ min: -10_000, max: -1 }),
  fc.double({ min: -1e9, max: -Number.MIN_VALUE, noNaN: true })
);

describe('Feature: plan-claims-audit, Property 7: Optional messages respect the allowance', () => {
  it('denies once used reaches included + topup', () => {
    fc.assert(
      fc.property(countArb, countArb, fc.nat({ max: 10_000 }), (included, topup, extra) => {
        const used = included + topup + extra;
        expect(hasAllowance(used, included, topup)).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  it('allows while used is below included + topup', () => {
    fc.assert(
      fc.property(
        countArb,
        countArb,
        fc.integer({ min: 1, max: 20_000 }),
        (included, topup, gap) => {
          fc.pre(included + topup > 0);
          const used = Math.max(0, included + topup - gap);
          expect(hasAllowance(used, included, topup)).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('a bad included or topup value never grants more than the finite non-negative part', () => {
    fc.assert(
      fc.property(
        countArb,
        countArb,
        badAllowanceArb,
        fc.boolean(),
        (used, good, bad, badIsIncluded) => {
          const [included, topup] = badIsIncluded ? [bad, good] : [good, bad];
          // The bad value counts as 0, so the allowance is exactly `good`.
          expect(hasAllowance(used, included, topup)).toBe(used < good);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('a negative used counts as 0 and a NaN used denies', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000, max: -1 }),
        countArb,
        countArb,
        (used, included, topup) => {
          expect(hasAllowance(used, included, topup)).toBe(included + topup > 0);
          expect(hasAllowance(Number.NaN, included, topup)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it.each([
    ['Infinity included, large used', 1_000_000, Number.POSITIVE_INFINITY, 0, false],
    ['Infinity topup, large used', 1_000_000, 800, Number.POSITIVE_INFINITY, false],
    ['NaN included and topup', 0, Number.NaN, Number.NaN, false],
    ['exactly at the Solo allowance', 800, 800, 0, false],
    ['one below the Solo allowance', 799, 800, 0, true],
    ['plan used up, top-up left', 2_000, 2_000, 50, true],
    ['plan and top-up used up', 2_050, 2_000, 50, false],
  ] as const)('%s', (_label, used, included, topup, expected) => {
    expect(hasAllowance(used, included, topup)).toBe(expected);
  });
});
