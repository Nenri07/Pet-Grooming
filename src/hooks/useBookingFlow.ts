/**
 * useBookingFlow — multi-step booking flow state machine.
 *
 * Implements the public booking flow as a `useReducer` state machine over six
 * ordered steps:
 *
 *   pet-info → owner-details → estimate → calendar → payment → success
 *
 * Design note (Property 6 — state preservation): forward transitions capture
 * step data into state, and `GO_BACK` (or `GO_TO_STEP`) ONLY changes the
 * `currentStep`/`stepIndex` cursor. No action ever clears data belonging to a
 * later step, so navigating back and forth is lossless. This guarantees that a
 * Client who returns to an earlier step keeps everything they previously
 * entered (Requirements 3.6, 4.5).
 *
 * The pure `bookingReducer` and `initialBookingState` are exported so the
 * property test (task 6.2) can exercise the state machine without React.
 *
 * _Requirements: 3.1, 3.5, 3.6, 4.5, 18.7_
 */
import { useReducer, type Dispatch } from 'react';
import type {
  EstimateResult,
  OwnerDetailsInput,
  PaymentResult,
  PetInfoInput,
  TimeSlot,
} from '@/types';

/** The ordered steps of the booking flow. */
export type BookingStep =
  | 'pet-info'
  | 'owner-details'
  | 'estimate'
  | 'calendar'
  | 'payment'
  | 'success';

/**
 * The ordered list of steps. `stepIndex` is always an index into this array
 * and `currentStep === STEPS[stepIndex]` is an invariant maintained by the
 * reducer.
 */
export const STEPS: readonly BookingStep[] = [
  'pet-info',
  'owner-details',
  'estimate',
  'calendar',
  'payment',
  'success',
] as const;

/**
 * The number of user-facing progress steps shown in the progress indicator.
 * Per Requirement 3.5 the indicator shows "current step out of 5"; the final
 * `success` step is the terminal confirmation and is not counted as one of the
 * five data-entry steps.
 */
export const TOTAL_PROGRESS_STEPS = 5;

/** All captured booking data plus the navigation cursor. */
export interface BookingState {
  currentStep: BookingStep;
  stepIndex: number;
  petInfo: PetInfoInput | null;
  ownerDetails: OwnerDetailsInput | null;
  /**
   * Whether the client consented to appointment-update SMS at step 2
   * (Master Spec §12.3). Unchecked by default; threaded to the deposit intent →
   * webhook so `Client.smsConsentAt` is stamped on fulfilment.
   */
  smsConsent: boolean;
  estimate: EstimateResult | null;
  selectedSlot: TimeSlot | null;
  paymentResult: PaymentResult | null;
}

export type BookingAction =
  | { type: 'SUBMIT_PET_INFO'; payload: PetInfoInput }
  | { type: 'SUBMIT_OWNER_DETAILS'; payload: OwnerDetailsInput; smsConsent?: boolean }
  | { type: 'CONFIRM_ESTIMATE'; payload: EstimateResult }
  | { type: 'SELECT_SLOT'; payload: TimeSlot }
  | { type: 'PAYMENT_SUCCESS'; payload: PaymentResult }
  | { type: 'GO_BACK' }
  | { type: 'GO_TO_STEP'; payload: number };

/** The pristine state a booking flow starts from (step 1, no data captured). */
export const initialBookingState: BookingState = {
  currentStep: 'pet-info',
  stepIndex: 0,
  petInfo: null,
  ownerDetails: null,
  smsConsent: false,
  estimate: null,
  selectedSlot: null,
  paymentResult: null,
};

/** Clamp `index` into the valid `[0, STEPS.length - 1]` range. */
function clampStepIndex(index: number): number {
  if (Number.isNaN(index)) return 0;
  return Math.max(0, Math.min(STEPS.length - 1, Math.trunc(index)));
}

/**
 * Pure reducer for the booking flow state machine.
 *
 * Forward-progress actions merge their payload into state and advance the
 * cursor. Navigation actions (`GO_BACK`, `GO_TO_STEP`) move ONLY the cursor and
 * never discard captured data, preserving state on back/forward navigation
 * (Property 6 / Requirements 3.6, 4.5).
 */
export function bookingReducer(
  state: BookingState,
  action: BookingAction
): BookingState {
  switch (action.type) {
    case 'SUBMIT_PET_INFO':
      return {
        ...state,
        petInfo: action.payload,
        currentStep: 'owner-details',
        stepIndex: 1,
      };
    case 'SUBMIT_OWNER_DETAILS':
      return {
        ...state,
        ownerDetails: action.payload,
        // Persist the consent checkbox alongside the owner details so back/
        // forward navigation stays lossless (Property 6). Defaults false.
        smsConsent: action.smsConsent ?? state.smsConsent,
        currentStep: 'estimate',
        stepIndex: 2,
      };
    case 'CONFIRM_ESTIMATE':
      return {
        ...state,
        estimate: action.payload,
        currentStep: 'calendar',
        stepIndex: 3,
      };
    case 'SELECT_SLOT':
      return {
        ...state,
        selectedSlot: action.payload,
        currentStep: 'payment',
        stepIndex: 4,
      };
    case 'PAYMENT_SUCCESS':
      return {
        ...state,
        paymentResult: action.payload,
        currentStep: 'success',
        stepIndex: 5,
      };
    case 'GO_BACK': {
      // Move the cursor back one step WITHOUT touching any captured data.
      const prevIndex = clampStepIndex(state.stepIndex - 1);
      return { ...state, currentStep: STEPS[prevIndex], stepIndex: prevIndex };
    }
    case 'GO_TO_STEP': {
      // Jump the cursor to an arbitrary step WITHOUT touching captured data.
      const nextIndex = clampStepIndex(action.payload);
      return { ...state, currentStep: STEPS[nextIndex], stepIndex: nextIndex };
    }
    default:
      return state;
  }
}

/**
 * Shared prop contract for the placeholder step components that are driven
 * directly by the reducer (owner-details, estimate, calendar, payment,
 * success). The fully-built forms (e.g. StepPetInfo from task 6.3) define
 * their own richer prop contracts; the BookingFlow container adapts between
 * the two. `services` carries the groomer's active services for steps that
 * need pricing/duration context.
 */
export interface BookingStepProps {
  state: BookingState;
  dispatch: Dispatch<BookingAction>;
  services: BookingStepServices;
  /** The groomer's public booking slug, used by steps that call server
   * actions scoped to the groomer (e.g. the estimate step). */
  groomerSlug: string;
}

/** Minimal, serializable service shape passed down to steps. */
export type BookingStepServices = Array<{
  name: string;
  basePrice: number;
  durationMinutes: number;
}>;

/** React hook wrapping the booking reducer. */
export function useBookingFlow(initialState: BookingState = initialBookingState) {
  const [state, dispatch] = useReducer(bookingReducer, initialState);
  return { state, dispatch, steps: STEPS, totalSteps: TOTAL_PROGRESS_STEPS };
}

export default useBookingFlow;
