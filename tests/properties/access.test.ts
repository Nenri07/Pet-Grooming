import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  evaluateAccess,
  toAccessClaim,
  accessFromClaim,
  type AccessInput,
  type AccessState,
  type AccessDecision,
} from '@/lib/billing/access';
import { GRACE_PERIOD_DAYS } from '@/lib/billing/entitlements';

/** Milliseconds in one day — mirrors the private DAY_MS in access.ts. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The grace window in milliseconds, derived (never hardcode 7). */
const GRACE_MS = GRACE_PERIOD_DAYS * DAY_MS;

const ALL_STATES: readonly AccessState[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'none',
] as const;

/**
 * Independent reference implementation of the lockout state machine (the
 * oracle). Derived straight from design.md "Correctness Properties → Property
 * 4" and the documented rules on evaluateAccess, NOT from the implementation
 * under test, so it can catch a divergent implementation.
 */
function expectedDecision(input: AccessInput): AccessDecision {
  const now = input.now.getTime();
  switch (input.status) {
    case 'active':
      return { allow: true };
    case 'trialing': {
      if (input.trialDeadline != null && now < input.trialDeadline.getTime()) {
        return { allow: true };
      }
      return { allow: false, reason: 'trial_expired' };
    }
    case 'past_due': {
      if (
        input.pastDueSince != null &&
        now < input.pastDueSince.getTime() + GRACE_MS
      ) {
        return { allow: true };
      }
      return { allow: false, reason: 'inactive' };
    }
    case 'canceled':
    case 'none':
    default:
      return { allow: false, reason: 'inactive' };
  }
}

// Generators ---------------------------------------------------------------

/** A Date within a wide-but-finite epoch window, or null. */
const dateOrNull = fc.option(
  fc.integer({ min: 0, max: 4_102_444_800_000 }).map((ms) => new Date(ms)),
  { nil: null }
);

const nowArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms));

const accessInputArb: fc.Arbitrary<AccessInput> = fc.record({
  status: fc.constantFrom(...ALL_STATES),
  trialDeadline: dateOrNull,
  pastDueSince: dateOrNull,
  now: nowArb,
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 4: evaluateAccess correctness
//
// For arbitrary billing state (random status across all 5 states, random
// trialDeadline/pastDueSince as Date|null, random now), evaluateAccess SHALL
// produce the decision dictated by the documented state machine:
//   - active                                         -> allow
//   - trialing & deadline != null & now < deadline   -> allow
//   - trialing & (deadline == null || now >= deadline) -> lockout trial_expired
//   - past_due & pastDueSince != null & now < pastDueSince + GRACE -> allow
//   - past_due otherwise                             -> lockout inactive
//   - canceled | none                                -> lockout inactive
//
// Validates: Requirements 3.1, 3.3, 3.4
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 4: evaluateAccess correctness', () => {
  it('matches the specified state machine for all inputs', () => {
    fc.assert(
      fc.property(accessInputArb, (input) => {
        expect(evaluateAccess(input)).toEqual(expectedDecision(input));
      }),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 4b: monotonicity in time
//
// For a fixed status/trialDeadline/pastDueSince, if evaluateAccess returns a
// lockout at now = t, it returns a lockout for every t' > t.
//
// Validates: Requirements 3.1, 3.3, 3.4
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 4b: evaluateAccess is monotonic in time', () => {
  it('once locked out at t, stays locked out for all t\u2032 > t', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STATES),
        dateOrNull,
        dateOrNull,
        nowArb,
        fc.integer({ min: 1, max: 10 * 365 * DAY_MS }), // positive delta
        (status, trialDeadline, pastDueSince, now, delta) => {
          const atT = evaluateAccess({ status, trialDeadline, pastDueSince, now });
          if (atT.allow) return; // property only constrains the lockout case
          const later = new Date(now.getTime() + delta);
          const atLater = evaluateAccess({
            status,
            trialDeadline,
            pastDueSince,
            now: later,
          });
          expect(atLater.allow).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 4c: claim round-trip
//
// For arbitrary AccessInput x,
//   accessFromClaim(toAccessClaim(x), x.now) deep-equals evaluateAccess(x).
//
// Validates: Requirements 3.1, 3.4
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 4c: claim round-trip preserves the decision', () => {
  it('accessFromClaim(toAccessClaim(x), x.now) === evaluateAccess(x)', () => {
    fc.assert(
      fc.property(accessInputArb, (input) => {
        const roundTripped = accessFromClaim(toAccessClaim(input), input.now);
        expect(roundTripped).toEqual(evaluateAccess(input));
      }),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments: explicit per-status examples
//
// Concrete anchor cases, one per branch of the state machine.
//
// Validates: Requirements 3.1, 3.3, 3.4
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 4: per-status examples', () => {
  const now = new Date('2025-06-15T12:00:00.000Z');

  it('active -> allow', () => {
    expect(
      evaluateAccess({ status: 'active', trialDeadline: null, pastDueSince: null, now })
    ).toEqual({ allow: true });
  });

  it('trialing before deadline -> allow', () => {
    const trialDeadline = new Date(now.getTime() + DAY_MS); // one day in the future
    expect(
      evaluateAccess({ status: 'trialing', trialDeadline, pastDueSince: null, now })
    ).toEqual({ allow: true });
  });

  it('trialing at/after deadline -> lockout trial_expired', () => {
    const trialDeadline = new Date(now.getTime() - DAY_MS); // one day in the past
    expect(
      evaluateAccess({ status: 'trialing', trialDeadline, pastDueSince: null, now })
    ).toEqual({ allow: false, reason: 'trial_expired' });
    // Exactly at the deadline is also a lockout (now >= deadline).
    expect(
      evaluateAccess({ status: 'trialing', trialDeadline: now, pastDueSince: null, now })
    ).toEqual({ allow: false, reason: 'trial_expired' });
  });

  it('trialing with null deadline -> lockout trial_expired', () => {
    expect(
      evaluateAccess({ status: 'trialing', trialDeadline: null, pastDueSince: null, now })
    ).toEqual({ allow: false, reason: 'trial_expired' });
  });

  it('past_due within grace -> allow', () => {
    const pastDueSince = new Date(now.getTime() - (GRACE_MS - DAY_MS)); // still inside grace
    expect(
      evaluateAccess({ status: 'past_due', trialDeadline: null, pastDueSince, now })
    ).toEqual({ allow: true });
  });

  it('past_due after grace -> lockout inactive', () => {
    const pastDueSince = new Date(now.getTime() - (GRACE_MS + DAY_MS)); // beyond grace
    expect(
      evaluateAccess({ status: 'past_due', trialDeadline: null, pastDueSince, now })
    ).toEqual({ allow: false, reason: 'inactive' });
    // Exactly at the grace boundary is a lockout (now >= pastDueSince + GRACE).
    const atBoundary = new Date(now.getTime() - GRACE_MS);
    expect(
      evaluateAccess({ status: 'past_due', trialDeadline: null, pastDueSince: atBoundary, now })
    ).toEqual({ allow: false, reason: 'inactive' });
    // Null pastDueSince -> lockout inactive.
    expect(
      evaluateAccess({ status: 'past_due', trialDeadline: null, pastDueSince: null, now })
    ).toEqual({ allow: false, reason: 'inactive' });
  });

  it('canceled -> lockout inactive', () => {
    expect(
      evaluateAccess({ status: 'canceled', trialDeadline: null, pastDueSince: null, now })
    ).toEqual({ allow: false, reason: 'inactive' });
  });

  it('none -> lockout inactive', () => {
    expect(
      evaluateAccess({ status: 'none', trialDeadline: null, pastDueSince: null, now })
    ).toEqual({ allow: false, reason: 'inactive' });
  });
});
