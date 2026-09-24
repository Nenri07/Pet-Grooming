/**
 * Estimate Engine.
 *
 * Computes an instant price-range estimate for a grooming booking based on the
 * pet's weight, coat condition, the service base price, and the groomer's
 * configured estimate rules.
 *
 * Algorithm (per design — Estimate Engine section):
 *   base = serviceBasePrice * coatMultiplier * weightMultiplier
 *   adj  = clamp(sum of matching rule priceAdjustmentPercent, -50, +50)
 *   base = base * (1 + adj / 100)
 *   min  = max(0.01, round2(base * 0.9))
 *   max  = round2(base * 1.1)
 *
 * Guarantees for all valid inputs: minPrice > 0 and minPrice <= maxPrice.
 *
 * _Requirements: 5.2, 5.3_
 */

import type { CoatCondition, EstimateInput, EstimateResult, EstimateRule } from '@/types';

/** Multiplier applied to the base price for each coat condition. */
const BASE_COAT_MULTIPLIERS: Record<CoatCondition, number> = {
  smooth: 1.0,
  double: 1.2,
  wire: 1.15,
  curly: 1.25,
  long: 1.3,
  matted: 1.5,
};

/** Weight tiers (upper bound inclusive) and their multipliers. */
const WEIGHT_TIERS: ReadonlyArray<{ max: number; multiplier: number }> = [
  { max: 15, multiplier: 0.8 }, // Small
  { max: 40, multiplier: 1.0 }, // Medium
  { max: 80, multiplier: 1.3 }, // Large
  { max: 200, multiplier: 1.6 }, // Extra Large
];

/**
 * Calculate the estimated price range for a booking.
 */
export function calculateEstimate(input: EstimateInput): EstimateResult {
  const { petWeight, coatCondition, serviceBasePrice, estimateRules } = input;

  // Base calculation.
  const coatMultiplier = BASE_COAT_MULTIPLIERS[coatCondition] ?? 1.0;
  const weightTier =
    WEIGHT_TIERS.find((tier) => petWeight <= tier.max) ?? WEIGHT_TIERS[WEIGHT_TIERS.length - 1];
  const weightMultiplier = weightTier.multiplier;

  let baseEstimate = serviceBasePrice * coatMultiplier * weightMultiplier;

  // Apply the groomer's custom rules by summing matching adjustments.
  let totalAdjustment = 0;
  for (const rule of estimateRules) {
    if (ruleApplies(rule, petWeight, coatCondition)) {
      totalAdjustment += rule.priceAdjustmentPercent;
    }
  }

  // Clamp the total adjustment to the -50% .. +50% range.
  totalAdjustment = Math.max(-50, Math.min(50, totalAdjustment));
  baseEstimate *= 1 + totalAdjustment / 100;

  // Return the range: min = 90% of base (floored at 0.01), max = 110% of base.
  const minPrice = Math.max(0.01, roundToTwoDecimals(baseEstimate * 0.9));
  // For a very small base the raw 110% figure can round to 0.00, which would
  // fall below the 0.01 floor applied to minPrice and break the minPrice <=
  // maxPrice guarantee. Ensure maxPrice is never less than minPrice.
  const maxPrice = Math.max(minPrice, roundToTwoDecimals(baseEstimate * 1.1));

  return { minPrice, maxPrice, currency: 'USD' };
}

/**
 * Determine whether a groomer rule applies to the given pet weight and coat.
 * A rule with no coat condition matches any coat; a rule with no weight range
 * (or partial bounds) matches accordingly.
 */
function ruleApplies(rule: EstimateRule, weight: number, coat: CoatCondition): boolean {
  const coatMatch = !rule.coatCondition || rule.coatCondition === coat;

  let weightMatch = true;
  if (rule.weightRange) {
    const { min, max } = rule.weightRange;
    if (min !== undefined && weight < min) {
      weightMatch = false;
    }
    if (max !== undefined && weight > max) {
      weightMatch = false;
    }
  }

  return coatMatch && weightMatch;
}

/**
 * Round a monetary value to exactly two decimal places.
 *
 * `Math.round(value * 100) / 100` is not reliable for larger magnitudes: the
 * `value * 100` re-multiplication introduces IEEE-754 representation error, so
 * the result can be a value that is not stably representable at 2 decimals.
 *
 * `Number(value.toFixed(2))` performs correctly-rounded decimal formatting and
 * then parses back to the nearest double, yielding a number that is exact and
 * stable when formatted to two decimals for every display-range amount here.
 */
function roundToTwoDecimals(value: number): number {
  return Number(value.toFixed(2));
}
