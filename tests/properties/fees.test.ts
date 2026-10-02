import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  computeApplicationFee,
  ZERO_DECIMAL_CURRENCIES,
} from '@/lib/billing/fees';

// Currencies drawn from both normal and zero-decimal buckets, matching the
// design's requirement that the fee math stays currency-agnostic.
const NORMAL_CURRENCIES = ['usd', 'eur', 'gbp'] as const;
const ZERO_DECIMAL = ['jpy', 'krw'] as const;
const ALL_CURRENCIES = [...NORMAL_CURRENCIES, ...ZERO_DECIMAL] as const;

// Sanity-check the generator currencies are classified as expected so the
// test corpus genuinely spans both branches of the zero-decimal distinction.
for (const c of ZERO_DECIMAL) {
  if (!ZERO_DECIMAL_CURRENCIES.has(c)) {
    throw new Error(`test setup: expected ${c} to be a zero-decimal currency`);
  }
}
for (const c of NORMAL_CURRENCIES) {
  if (ZERO_DECIMAL_CURRENCIES.has(c)) {
    throw new Error(`test setup: expected ${c} to be a normal currency`);
  }
}

// Generators ---------------------------------------------------------------

/** A non-negative integer charge amount in minor units, 0 .. 100_000_000. */
const amountArb = fc.integer({ min: 0, max: 100_000_000 });

/**
 * A rate percent in [0,100] including fractional values. `fc.double` with
 * `noNaN`/`noDefaultInfinity` keeps it finite; fractional rates exercise the
 * rounding path in computeApplicationFee.
 */
const rateArb = fc.double({
  min: 0,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

const currencyArb = fc.constantFrom(...ALL_CURRENCIES);

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 1: computeApplicationFee bounds
//
// For arbitrary amountMinor (0 .. 100_000_000), arbitrary ratePercent in
// [0,100] (incl. fractional), and a currency drawn from both normal (usd, eur,
// gbp) and zero-decimal (jpy, krw) codes:
//   - the result is an integer (Number.isInteger);
//   - 0 <= fee <= amountMinor;
//   - fee === 0 when ratePercent === 0 (and when amountMinor === 0);
//   - non-decreasing in ratePercent: r1 <= r2 (same amount+currency) implies
//     computeApplicationFee(a,c,r1) <= computeApplicationFee(a,c,r2).
//
// Validates: Requirements 16.2
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 1: computeApplicationFee bounds', () => {
  it('result is an integer within [0, amountMinor] for any rate and currency', () => {
    fc.assert(
      fc.property(amountArb, currencyArb, rateArb, (amount, currency, rate) => {
        const fee = computeApplicationFee(amount, currency, rate);
        expect(Number.isInteger(fee)).toBe(true);
        expect(fee).toBeGreaterThanOrEqual(0);
        expect(fee).toBeLessThanOrEqual(amount);
      }),
      { numRuns: 300 }
    );
  });

  it('fee === 0 when ratePercent === 0, and when amountMinor === 0', () => {
    fc.assert(
      fc.property(amountArb, currencyArb, (amount, currency) => {
        // rate 0 => no fee regardless of amount
        expect(computeApplicationFee(amount, currency, 0)).toBe(0);
      }),
      { numRuns: 150 }
    );
    fc.assert(
      fc.property(currencyArb, rateArb, (currency, rate) => {
        // amount 0 => no fee regardless of rate
        expect(computeApplicationFee(0, currency, rate)).toBe(0);
      }),
      { numRuns: 150 }
    );
  });

  it('is non-decreasing in ratePercent for a fixed amount and currency', () => {
    fc.assert(
      fc.property(
        amountArb,
        currencyArb,
        rateArb,
        rateArb,
        (amount, currency, ra, rb) => {
          const r1 = Math.min(ra, rb);
          const r2 = Math.max(ra, rb);
          const fee1 = computeApplicationFee(amount, currency, r1);
          const fee2 = computeApplicationFee(amount, currency, r2);
          expect(fee1).toBeLessThanOrEqual(fee2);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 1: explicit examples
//
// Concrete anchor cases covering the documented clamping behaviour.
//
// Validates: Requirements 16.2
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 1: computeApplicationFee examples', () => {
  it('rate 0 -> 0', () => {
    expect(computeApplicationFee(10000, 'usd', 0)).toBe(0);
  });

  it('rate 100 -> full amount', () => {
    expect(computeApplicationFee(10000, 'usd', 100)).toBe(10000);
  });

  it('amount 0 -> 0', () => {
    expect(computeApplicationFee(0, 'usd', 2.5)).toBe(0);
  });

  it('mid example (10000, usd, 2.5) -> 250', () => {
    expect(computeApplicationFee(10000, 'usd', 2.5)).toBe(250);
  });

  it('zero-decimal (1000, jpy, 10) -> 100', () => {
    expect(computeApplicationFee(1000, 'jpy', 10)).toBe(100);
  });

  it('rate > 100 clamps to full amount', () => {
    expect(computeApplicationFee(10000, 'usd', 150)).toBe(10000);
  });

  it('negative rate -> 0', () => {
    expect(computeApplicationFee(10000, 'usd', -5)).toBe(0);
  });

  it('NaN rate -> 0', () => {
    expect(computeApplicationFee(10000, 'usd', Number.NaN)).toBe(0);
  });

  it('negative amount -> 0', () => {
    expect(computeApplicationFee(-10000, 'usd', 2.5)).toBe(0);
  });
});
