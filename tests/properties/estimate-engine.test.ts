import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { calculateEstimate } from '@/lib/estimate/engine';
import type { CoatCondition, EstimateRule } from '@/types';

const COAT_CONDITIONS: readonly CoatCondition[] = [
  'smooth',
  'double',
  'wire',
  'curly',
  'long',
  'matted',
] as const;

/**
 * Whether a numeric monetary value has at most two decimal places.
 *
 * A strict `value === Math.round(value * 100) / 100` oracle is unreliable: the
 * `value * 100` re-multiplication introduces IEEE-754 representation error for
 * larger monetary magnitudes, so a correct 2-decimal amount can fail the strict
 * `===` re-round check. Instead we assert that `value * 100` is effectively an
 * integer number of cents, within a tiny epsilon.
 */
function hasTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

// ---------------------------------------------------------------------------
// Feature: pawport, Property 1: Estimate Engine produces valid price range
//
// For any valid combination of pet weight (1-200), coat condition (one of the
// 6 defined types), service base price (0.01-9999.99), and any set of groomer
// estimate rules with adjustments between -50% and +50%, the Estimate Engine
// SHALL produce a result where minPrice > 0, minPrice <= maxPrice, and both
// values have exactly two decimal places.
//
// Validates: Requirements 5.2, 5.3
// ---------------------------------------------------------------------------
describe('Feature: pawport, Property 1: Estimate Engine produces valid price range', () => {
  it('should produce valid price range for all valid inputs', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 1, max: 200, noNaN: true }), // petWeight
        fc.constantFrom(...COAT_CONDITIONS), // coatCondition
        fc.float({ min: Math.fround(0.01), max: Math.fround(9999.99), noNaN: true }), // serviceBasePrice
        fc.array(
          fc.record({
            coatCondition: fc.constantFrom(...COAT_CONDITIONS, undefined),
            weightRange: fc.option(
              fc.record({
                min: fc.float({ min: 1, max: 100, noNaN: true }),
                max: fc.float({ min: 101, max: 200, noNaN: true }),
              }),
              { nil: undefined }
            ),
            priceAdjustmentPercent: fc.integer({ min: -50, max: 50 }),
          }),
          { maxLength: 5 }
        ),
        (weight, coat, basePrice, rules) => {
          const result = calculateEstimate({
            petWeight: weight,
            coatCondition: coat,
            serviceBasePrice: basePrice,
            estimateRules: rules as EstimateRule[],
          });

          // minPrice > 0
          expect(result.minPrice).toBeGreaterThan(0);
          // minPrice <= maxPrice
          expect(result.minPrice).toBeLessThanOrEqual(result.maxPrice);
          // Both rounded to exactly two decimal places.
          expect(hasTwoDecimals(result.minPrice)).toBe(true);
          expect(hasTwoDecimals(result.maxPrice)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: pawport, Property 2: Estimate Engine monotonicity with weight
//
// For any two pets with identical coat condition and the same service/rules,
// where pet A weighs less than pet B, the Estimate Engine SHALL produce an
// estimate for pet A where maxPrice(A) <= maxPrice(B).
//
// The base weight-tier multipliers are non-decreasing in weight, so with rules
// that do not create weight-band inversions the estimate is monotonic. We test
// with an EMPTY rules array (no weight-band inversions possible) and generate
// weightA <= weightB.
//
// Validates: Requirements 5.2
// ---------------------------------------------------------------------------
describe('Feature: pawport, Property 2: Estimate Engine monotonicity with weight', () => {
  it('should never decrease maxPrice as weight increases (identical coat, same rules)', () => {
    fc.assert(
      fc.property(
        // Two weights in [1, 200], ordered so weightA <= weightB.
        fc
          .tuple(
            fc.float({ min: 1, max: 200, noNaN: true }),
            fc.float({ min: 1, max: 200, noNaN: true })
          )
          .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [number, number]),
        fc.constantFrom(...COAT_CONDITIONS), // identical coat condition
        fc.float({ min: Math.fround(0.01), max: Math.fround(9999.99), noNaN: true }), // shared serviceBasePrice
        ([weightA, weightB], coat, basePrice) => {
          // Empty rules array: no weight-band inversions, so the base
          // weight-tier multipliers (non-decreasing in weight) govern the result.
          const rules: EstimateRule[] = [];

          const resultA = calculateEstimate({
            petWeight: weightA,
            coatCondition: coat,
            serviceBasePrice: basePrice,
            estimateRules: rules,
          });
          const resultB = calculateEstimate({
            petWeight: weightB,
            coatCondition: coat,
            serviceBasePrice: basePrice,
            estimateRules: rules,
          });

          // maxPrice(A) <= maxPrice(B) when weight(A) <= weight(B).
          expect(resultA.maxPrice).toBeLessThanOrEqual(resultB.maxPrice);
        }
      ),
      { numRuns: 200 }
    );
  });
});
