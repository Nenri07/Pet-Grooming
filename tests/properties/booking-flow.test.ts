import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  STEPS,
  bookingReducer,
  initialBookingState,
  type BookingAction,
  type BookingState,
} from '@/hooks/useBookingFlow';
import type {
  CoatCondition,
  EstimateResult,
  OwnerDetailsInput,
  PaymentResult,
  PetInfoInput,
  Temperament,
  TimeSlot,
  TransactionStatus,
  WeightUnit,
} from '@/types';

const COAT_CONDITIONS: readonly CoatCondition[] = [
  'smooth',
  'double',
  'wire',
  'curly',
  'long',
  'matted',
] as const;
const TEMPERAMENTS: readonly Temperament[] = [
  'calm',
  'nervous',
  'aggressive',
  'friendly',
] as const;
const WEIGHT_UNITS: readonly WeightUnit[] = ['lbs', 'kg'] as const;
const TX_STATUSES: readonly TransactionStatus[] = [
  'pending',
  'succeeded',
  'failed',
  'refunded',
] as const;

// ---------------------------------------------------------------------------
// Arbitraries for each forward-action payload.
//
// Exact field values only matter for the deep-equality checks below, so simple
// representative shapes matching the types are sufficient.
// ---------------------------------------------------------------------------

const petInfoArb: fc.Arbitrary<PetInfoInput> = fc.record({
  name: fc.string(),
  photoUrl: fc.option(fc.webUrl(), { nil: undefined }),
  breed: fc.string(),
  weight: fc.float({ min: 1, max: 200, noNaN: true }),
  weightUnit: fc.constantFrom(...WEIGHT_UNITS),
  age: fc.float({ min: 0, max: 30, noNaN: true }),
  temperament: fc.constantFrom(...TEMPERAMENTS),
  coatCondition: fc.constantFrom(...COAT_CONDITIONS),
  specialFlags: fc.option(fc.array(fc.string()), { nil: undefined }),
  notes: fc.option(fc.string(), { nil: undefined }),
});

const ownerDetailsArb: fc.Arbitrary<OwnerDetailsInput> = fc.record({
  name: fc.string(),
  email: fc.emailAddress(),
  phone: fc.string(),
  address: fc.record({
    street: fc.string(),
    city: fc.string(),
    state: fc.string(),
    postalCode: fc.string(),
  }),
});

const estimateArb: fc.Arbitrary<EstimateResult> = fc.record({
  minPrice: fc.float({ min: 0, max: 10000, noNaN: true }),
  maxPrice: fc.float({ min: 0, max: 10000, noNaN: true }),
  currency: fc.constantFrom('USD', 'EUR', 'GBP'),
});

const slotArb: fc.Arbitrary<TimeSlot> = fc.record({
  start: fc.date({ noInvalidDate: true }),
  end: fc.date({ noInvalidDate: true }),
  available: fc.boolean(),
});

const paymentArb: fc.Arbitrary<PaymentResult> = fc.record({
  paymentIntentId: fc.string(),
  status: fc.constantFrom(...TX_STATUSES),
  amount: fc.float({ min: 0, max: 500, noNaN: true }),
  currency: fc.constantFrom('USD', 'EUR', 'GBP'),
  clientSecret: fc.option(fc.string(), { nil: undefined }),
  errorMessage: fc.option(fc.string(), { nil: undefined }),
});

/**
 * A captured forward action along with the state key it populates, so we can
 * later assert that field is preserved across back/forward navigation.
 */
interface ForwardStep {
  action: BookingAction;
  field: keyof BookingState;
}

/**
 * Arbitrary that produces an ordered sequence of the first N forward actions
 * (1..5), each carrying a fresh payload. The order is fixed by the state
 * machine: pet-info → owner-details → estimate → calendar → payment.
 */
const forwardSequenceArb: fc.Arbitrary<ForwardStep[]> = fc
  .tuple(petInfoArb, ownerDetailsArb, estimateArb, slotArb, paymentArb)
  .chain(([pet, owner, estimate, slot, payment]) => {
    const all: ForwardStep[] = [
      { action: { type: 'SUBMIT_PET_INFO', payload: pet }, field: 'petInfo' },
      { action: { type: 'SUBMIT_OWNER_DETAILS', payload: owner }, field: 'ownerDetails' },
      { action: { type: 'CONFIRM_ESTIMATE', payload: estimate }, field: 'estimate' },
      { action: { type: 'SELECT_SLOT', payload: slot }, field: 'selectedSlot' },
      { action: { type: 'PAYMENT_SUCCESS', payload: payment }, field: 'paymentResult' },
    ];
    // N in [1, 5]: how many forward steps the user completes.
    return fc.integer({ min: 1, max: all.length }).map((n) => all.slice(0, n));
  });

/** The five data fields that must never change on navigation. */
const DATA_FIELDS: ReadonlyArray<keyof BookingState> = [
  'petInfo',
  'ownerDetails',
  'estimate',
  'selectedSlot',
  'paymentResult',
];

function assertInvariant(state: BookingState): void {
  // currentStep === STEPS[stepIndex] must hold after every action.
  // Note: PAYMENT_SUCCESS sets stepIndex 5 ('success'), the terminal step.
  expect(state.currentStep).toBe(STEPS[state.stepIndex]);
}

// ---------------------------------------------------------------------------
// Feature: pawport, Property 6: Booking flow state preservation on back navigation
//
// For any booking flow state where the user has completed steps 1..N,
// navigating back to any step K (K<N) and then forward again SHALL preserve
// all data entered in steps K+1..N. Only currentStep/stepIndex may change.
//
// Validates: Requirements 3.6, 4.5
// ---------------------------------------------------------------------------
describe('Feature: pawport, Property 6: Booking flow state preservation on back navigation', () => {
  it('preserves all captured data when navigating GO_BACK an arbitrary number of times', () => {
    fc.assert(
      fc.property(
        forwardSequenceArb,
        fc.integer({ min: 0, max: 10 }), // number of GO_BACK dispatches
        (forward, backCount) => {
          // Build state up to step N, capturing each populated field's value.
          let state = initialBookingState;
          const captured = new Map<keyof BookingState, unknown>();
          for (const step of forward) {
            state = bookingReducer(state, step.action);
            assertInvariant(state);
            captured.set(step.field, state[step.field]);
          }

          const builtState = state;

          // Dispatch GO_BACK an arbitrary number of times.
          for (let i = 0; i < backCount; i++) {
            state = bookingReducer(state, { type: 'GO_BACK' });
            assertInvariant(state);
            // Data fields are unchanged relative to the fully-built state.
            for (const field of DATA_FIELDS) {
              expect(state[field]).toStrictEqual(builtState[field]);
            }
          }

          // Every captured field still deep-equals what was originally entered.
          for (const [field, value] of captured) {
            expect(state[field]).toStrictEqual(value);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('preserves data entered in steps K+1..N when jumping back to step K then forward again', () => {
    fc.assert(
      fc.property(
        forwardSequenceArb,
        fc.integer({ min: 0, max: 5 }), // target step K to jump back to
        (forward, kRaw) => {
          const n = forward.length;

          // Build state up to step N, capturing each populated field.
          let state = initialBookingState;
          const captured = new Map<keyof BookingState, unknown>();
          for (const step of forward) {
            state = bookingReducer(state, step.action);
            assertInvariant(state);
            captured.set(step.field, state[step.field]);
          }
          const builtState = state;

          // Choose K < N (clamp; when N===1 the only valid K is 0).
          const k = Math.min(kRaw, Math.max(0, n - 1));

          // Navigate back to step K via GO_TO_STEP — data must be untouched.
          state = bookingReducer(state, { type: 'GO_TO_STEP', payload: k });
          assertInvariant(state);
          expect(state.stepIndex).toBe(k);
          for (const field of DATA_FIELDS) {
            expect(state[field]).toStrictEqual(builtState[field]);
          }

          // Navigate forward again to the built step via GO_TO_STEP — still untouched.
          state = bookingReducer(state, {
            type: 'GO_TO_STEP',
            payload: builtState.stepIndex,
          });
          assertInvariant(state);
          for (const [field, value] of captured) {
            expect(state[field]).toStrictEqual(value);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
