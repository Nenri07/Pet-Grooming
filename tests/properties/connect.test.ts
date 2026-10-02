import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  mapConnectStatus,
  bookingAllowed,
  type ConnectStatus,
  type ConnectAccountView,
} from '@/lib/billing/connect';

// The five surfaced Connect states — the total codomain of mapConnectStatus.
const ALL_STATUSES: readonly ConnectStatus[] = [
  'not_started',
  'pending',
  'needs_info',
  'complete',
  'disabled',
] as const;

const STATUS_SET: ReadonlySet<ConnectStatus> = new Set(ALL_STATUSES);

// Generators ---------------------------------------------------------------

/** A short list of machine-code-ish requirement field names (possibly empty). */
const requirementListArb: fc.Arbitrary<string[]> = fc.array(
  fc.constantFrom(
    'external_account',
    'individual.id_number',
    'business_profile.url',
    'tos_acceptance.date',
    'individual.verification.document'
  ),
  { minLength: 0, maxLength: 4 }
);

/** disabled_reason: null, empty string (treated as absent), or a machine code. */
const disabledReasonArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constant(''),
  fc.constantFrom(
    'rejected.fraud',
    'requirements.past_due',
    'requirements.pending_verification',
    'listed'
  )
);

/** An arbitrary ConnectAccountView with randomized flags + requirements. */
const accountArb: fc.Arbitrary<ConnectAccountView> = fc.record({
  charges_enabled: fc.boolean(),
  details_submitted: fc.boolean(),
  requirements: fc.option(
    fc.record({
      currently_due: fc.option(requirementListArb, { nil: null }),
      past_due: fc.option(requirementListArb, { nil: null }),
      disabled_reason: disabledReasonArb,
    }),
    { nil: null }
  ),
});

/** account | null | undefined — covers the "no account yet" inputs too. */
const accountOrNullArb: fc.Arbitrary<ConnectAccountView | null | undefined> =
  fc.oneof(
    accountArb,
    fc.constant(null),
    fc.constant(undefined)
  );

/**
 * Independent reference implementation (the oracle) of the documented
 * precedence, derived straight from the connect.ts doc comment / design
 * Property 13 — NOT from the implementation under test, so a divergent
 * implementation is caught.
 *
 * Precedence (first match wins):
 *   1. account == null                        -> not_started
 *   2. charges_enabled === true               -> complete
 *   3. requirements.disabled_reason non-empty -> disabled
 *   4. currently_due OR past_due non-empty    -> needs_info
 *   5. details_submitted === true             -> pending
 *   6. otherwise                              -> not_started
 */
function expectedStatus(
  account: ConnectAccountView | null | undefined
): ConnectStatus {
  if (account == null) return 'not_started';
  if (account.charges_enabled === true) return 'complete';

  const req = account.requirements;
  const disabledReason = req?.disabled_reason;
  if (typeof disabledReason === 'string' && disabledReason.length > 0) {
    return 'disabled';
  }

  const nonEmpty = (list: string[] | null | undefined): boolean =>
    Array.isArray(list) && list.length > 0;
  if (nonEmpty(req?.currently_due) || nonEmpty(req?.past_due)) {
    return 'needs_info';
  }

  if (account.details_submitted === true) return 'pending';

  return 'not_started';
}

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 13: connect status mapping
//
// For an arbitrary ConnectAccountView (random charges_enabled/details_submitted,
// random-length currently_due/past_due arrays, optional disabled_reason) plus
// null/undefined, mapConnectStatus:
//   - is TOTAL: always returns one of the 5 ConnectStatus values;
//   - returns 'complete' IFF account?.charges_enabled === true;
//   - is IDEMPOTENT: mapping the same account twice yields the same status;
//   - matches the independent oracle reimplementing the documented precedence.
//
// Validates: Requirements 15.1, 15.4, 15.5
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 13: connect status mapping', () => {
  it('is total — always returns a member of the 5-value ConnectStatus set', () => {
    fc.assert(
      fc.property(accountOrNullArb, (account) => {
        expect(STATUS_SET.has(mapConnectStatus(account))).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it("returns 'complete' IFF charges_enabled === true", () => {
    fc.assert(
      fc.property(accountOrNullArb, (account) => {
        const isComplete = mapConnectStatus(account) === 'complete';
        const chargesEnabled = account?.charges_enabled === true;
        expect(isComplete).toBe(chargesEnabled);
      }),
      { numRuns: 300 }
    );
  });

  it('is idempotent — mapping the same account twice yields the same status', () => {
    fc.assert(
      fc.property(accountOrNullArb, (account) => {
        expect(mapConnectStatus(account)).toBe(mapConnectStatus(account));
      }),
      { numRuns: 300 }
    );
  });

  it('matches the independent precedence oracle for all inputs', () => {
    fc.assert(
      fc.property(accountOrNullArb, (account) => {
        expect(mapConnectStatus(account)).toBe(expectedStatus(account));
      }),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 13: precedence examples
//
// Concrete anchors, one per branch of the documented precedence, including the
// "complete outranks residual requirements/disabled_reason" case.
//
// Validates: Requirements 15.1, 15.4
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 13: precedence examples', () => {
  it('null -> not_started', () => {
    expect(mapConnectStatus(null)).toBe('not_started');
  });

  it('undefined -> not_started', () => {
    expect(mapConnectStatus(undefined)).toBe('not_started');
  });

  it('charges_enabled === true -> complete', () => {
    expect(
      mapConnectStatus({ charges_enabled: true, details_submitted: true })
    ).toBe('complete');
  });

  it('charges_enabled outranks disabled_reason + due requirements -> complete', () => {
    expect(
      mapConnectStatus({
        charges_enabled: true,
        details_submitted: true,
        requirements: {
          currently_due: ['external_account'],
          past_due: ['individual.id_number'],
          disabled_reason: 'rejected.fraud',
        },
      })
    ).toBe('complete');
  });

  it('disabled_reason non-empty (not charges-enabled) -> disabled', () => {
    expect(
      mapConnectStatus({
        charges_enabled: false,
        details_submitted: true,
        requirements: {
          currently_due: ['external_account'],
          disabled_reason: 'rejected.fraud',
        },
      })
    ).toBe('disabled');
  });

  it('disabled outranks needs_info -> disabled', () => {
    expect(
      mapConnectStatus({
        requirements: {
          currently_due: ['external_account'],
          past_due: ['individual.id_number'],
          disabled_reason: 'requirements.past_due',
        },
      })
    ).toBe('disabled');
  });

  it('currently_due non-empty -> needs_info', () => {
    expect(
      mapConnectStatus({
        details_submitted: true,
        requirements: { currently_due: ['external_account'] },
      })
    ).toBe('needs_info');
  });

  it('past_due non-empty -> needs_info', () => {
    expect(
      mapConnectStatus({
        details_submitted: true,
        requirements: { past_due: ['individual.id_number'] },
      })
    ).toBe('needs_info');
  });

  it('details_submitted === true, nothing due -> pending', () => {
    expect(
      mapConnectStatus({
        charges_enabled: false,
        details_submitted: true,
        requirements: { currently_due: [], past_due: [], disabled_reason: null },
      })
    ).toBe('pending');
  });

  it('empty disabled_reason string is treated as absent', () => {
    expect(
      mapConnectStatus({
        details_submitted: true,
        requirements: { disabled_reason: '' },
      })
    ).toBe('pending');
  });

  it('empty account ({}) -> not_started', () => {
    expect(mapConnectStatus({})).toBe('not_started');
  });

  it('details not submitted, nothing due -> not_started', () => {
    expect(
      mapConnectStatus({
        charges_enabled: false,
        details_submitted: false,
      })
    ).toBe('not_started');
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 14: bookingAllowed
//
// For arbitrary requiresDeposit: boolean and arbitrary connectStatus from the
// 5 values,
//   bookingAllowed(requiresDeposit, status) === (!requiresDeposit || status === 'complete')
//
// Validates: Requirements 17.2, 17.3
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 14: bookingAllowed', () => {
  it('matches !requiresDeposit || status === complete for all inputs', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom(...ALL_STATUSES),
        (requiresDeposit, status) => {
          expect(bookingAllowed(requiresDeposit, status)).toBe(
            !requiresDeposit || status === 'complete'
          );
        }
      ),
      { numRuns: 300 }
    );
  });

  it('no-deposit booking is always allowed, for every status', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_STATUSES), (status) => {
        expect(bookingAllowed(false, status)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 14: explicit examples
//
// no-deposit + any status -> true; deposit + complete -> true;
// deposit + each non-complete status -> false.
//
// Validates: Requirements 17.2, 17.3
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 14: bookingAllowed examples', () => {
  it('no-deposit + any status -> true', () => {
    for (const status of ALL_STATUSES) {
      expect(bookingAllowed(false, status)).toBe(true);
    }
  });

  it('deposit + complete -> true', () => {
    expect(bookingAllowed(true, 'complete')).toBe(true);
  });

  it('deposit + each non-complete status -> false', () => {
    const nonComplete = ALL_STATUSES.filter((s) => s !== 'complete');
    for (const status of nonComplete) {
      expect(bookingAllowed(true, status)).toBe(false);
    }
  });
});
