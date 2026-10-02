import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  identityConsumedTrial,
  shouldFlagVelocity,
  type BindingView,
} from '@/lib/identity/binding';

// Generators ---------------------------------------------------------------

/** A wide-but-finite epoch window used for both `now` and binding dates. */
const EPOCH_MIN = 0;
const EPOCH_MAX = 4_102_444_800_000; // 2100-01-01

const dateArb = fc
  .integer({ min: EPOCH_MIN, max: EPOCH_MAX })
  .map((ms) => new Date(ms));

/** An arbitrary binding: null | { firstTrialAt, bindingExpiresAt: Date|null }. */
const bindingArb: fc.Arbitrary<BindingView | null> = fc.option(
  fc.record({
    firstTrialAt: dateArb,
    bindingExpiresAt: fc.option(dateArb, { nil: null }),
  }),
  { nil: null }
);

const nowArb = dateArb;

/**
 * Independent reference implementation (the oracle), derived straight from the
 * documented decision in binding.ts / design.md Property 10, NOT from the
 * implementation under test — so a divergent implementation is caught.
 */
function expectedConsumed(binding: BindingView | null, now: Date): boolean {
  if (binding == null) return false;
  if (binding.bindingExpiresAt == null) return true;
  return now.getTime() < binding.bindingExpiresAt.getTime();
}

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 10: identityConsumedTrial
// expiry boundary
//
// For an arbitrary binding (null | { firstTrialAt, bindingExpiresAt: Date|null })
// and arbitrary now:
//   - null binding                     -> false
//   - bindingExpiresAt == null         -> true (always)
//   - bindingExpiresAt set             -> true iff now < bindingExpiresAt (STRICT)
//
// Validates: Requirements 11.2, 11.3
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 10: identityConsumedTrial expiry boundary', () => {
  it('matches the specified decision for all bindings and now', () => {
    fc.assert(
      fc.property(bindingArb, nowArb, (binding, now) => {
        expect(identityConsumedTrial(binding, now)).toBe(
          expectedConsumed(binding, now)
        );
      }),
      { numRuns: 300 }
    );
  });

  it('null binding is never consumed, for any now', () => {
    fc.assert(
      fc.property(nowArb, (now) => {
        expect(identityConsumedTrial(null, now)).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  it('a binding with null bindingExpiresAt is consumed forever', () => {
    fc.assert(
      fc.property(dateArb, nowArb, (firstTrialAt, now) => {
        expect(
          identityConsumedTrial({ firstTrialAt, bindingExpiresAt: null }, now)
        ).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('a binding with an expiry is consumed iff now < bindingExpiresAt (strict)', () => {
    fc.assert(
      fc.property(dateArb, dateArb, nowArb, (firstTrialAt, expiry, now) => {
        expect(
          identityConsumedTrial(
            { firstTrialAt, bindingExpiresAt: expiry },
            now
          )
        ).toBe(now.getTime() < expiry.getTime());
      }),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 10: expiry boundary examples
//
// Explicit boundary anchors: now == expiry -> false, now just below -> true,
// now just above -> false.
//
// Validates: Requirements 11.2, 11.3
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 10: expiry boundary examples', () => {
  const firstTrialAt = new Date('2025-01-01T00:00:00.000Z');
  const expiry = new Date('2025-06-15T12:00:00.000Z');
  const binding: BindingView = { firstTrialAt, bindingExpiresAt: expiry };

  it('null binding -> false', () => {
    expect(identityConsumedTrial(null, expiry)).toBe(false);
  });

  it('bindingExpiresAt == null -> true', () => {
    expect(
      identityConsumedTrial({ firstTrialAt, bindingExpiresAt: null }, expiry)
    ).toBe(true);
  });

  it('now == bindingExpiresAt -> false (expired/available at the exact instant)', () => {
    expect(identityConsumedTrial(binding, new Date(expiry.getTime()))).toBe(false);
  });

  it('now just below bindingExpiresAt -> true (still within the window)', () => {
    expect(
      identityConsumedTrial(binding, new Date(expiry.getTime() - 1))
    ).toBe(true);
  });

  it('now just above bindingExpiresAt -> false (expired)', () => {
    expect(
      identityConsumedTrial(binding, new Date(expiry.getTime() + 1))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 15: shouldFlagVelocity
//
// For arbitrary count (0..1000) and threshold (0..100),
//   shouldFlagVelocity(count, threshold) === (count > threshold).
//
// NOTE (default policy — flag-not-block, Requirement 12.3): a `true` result
// only means the attempt is RECORDED as flagged for operator review; under the
// stated default policy the trial still PROCEEDS (the pipeline returns an allow
// decision carrying `flagged: true`). This pure function decides ONLY the flag;
// the allow/record/escalate policy lives in the pipeline, not here.
//
// Validates: Requirements 12.2, 12.3
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 15: shouldFlagVelocity', () => {
  it('is true iff count > threshold, for all count/threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 100 }),
        (count, threshold) => {
          expect(shouldFlagVelocity(count, threshold)).toBe(count > threshold);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('count == threshold -> false (strictly greater-than)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (threshold) => {
        expect(shouldFlagVelocity(threshold, threshold)).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  it('count == threshold + 1 -> true', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (threshold) => {
        expect(shouldFlagVelocity(threshold + 1, threshold)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('default threshold 3: counts 0..3 are not flagged, 4 is flagged', () => {
    expect(shouldFlagVelocity(0, 3)).toBe(false);
    expect(shouldFlagVelocity(1, 3)).toBe(false);
    expect(shouldFlagVelocity(2, 3)).toBe(false);
    expect(shouldFlagVelocity(3, 3)).toBe(false);
    expect(shouldFlagVelocity(4, 3)).toBe(true);
  });
});
