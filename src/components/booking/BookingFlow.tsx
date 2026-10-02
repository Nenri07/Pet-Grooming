'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { stepTransition } from '@/components/ui/PageTransition';
import {
  useBookingFlow,
  TOTAL_PROGRESS_STEPS,
  type BookingStep,
  type BookingState,
  type BookingStepServices,
} from '@/hooks/useBookingFlow';
import { StepPetInfo } from './StepPetInfo';
import { StepOwnerDetails } from './StepOwnerDetails';
import { StepEstimate } from './StepEstimate';
import { StepCalendar } from './StepCalendar';
import { StepPayment } from './StepPayment';
import { StepSuccess } from './StepSuccess';
import { bookingAllowed } from '@/lib/billing/connect';

/** Serializable groomer info the server component passes to the flow. */
export interface BookingGroomer {
  slug: string;
  businessName: string;
  services: BookingStepServices;
  /**
   * Whether the groomer's Stripe Connect account can accept online payments
   * (effective connect status === 'complete'). When `false` and a deposit is
   * required, the flow blocks the payment step and shows the "online payments
   * not set up yet" state instead (R17.1).
   */
  paymentsReady: boolean;
  /**
   * Whether a booking requires an upfront deposit (the groomer configured a
   * deposit amount > 0). When `false`, bookings proceed without the payment
   * step (R17.2).
   */
  requiresDeposit: boolean;
  /** Optional business phone, surfaced in the not-set-up card so clients can
   * reach the groomer directly to book. */
  businessPhone?: string;
  /** Optional business email, surfaced in the not-set-up card. */
  businessEmail?: string;
}

/**
 * The pre-populated flow state a caller may pass in (§11.4 rebooking). Re-
 * exported as a TYPE-ONLY alias so server components (e.g. /rebook/[token]) can
 * type an initial-state literal WITHOUT importing the `useBookingFlow` hook
 * module (which uses `useReducer` and would drag a client-only dependency into
 * a Server Component).
 */
export type BookingInitialState = BookingState;

interface BookingFlowProps {
  groomer: BookingGroomer;
  /**
   * Optional pre-populated flow state (Master Spec §11.4 rebooking). When
   * provided, the flow starts from this state instead of the pristine step 1 —
   * used by `/rebook/{token}` to prefill pet + owner and jump to the estimate/
   * schedule steps. Omitted for the normal public booking flow.
   */
  initialState?: BookingState;
  /** Optional banner shown above the flow (e.g. the rebooking welcome-back). */
  prefillNotice?: string;
}

/** User-facing labels for the progress indicator. */
const STEP_LABELS: Record<BookingStep, string> = {
  'pet-info': 'Pet info',
  'owner-details': 'Your details',
  estimate: 'Estimate',
  calendar: 'Schedule',
  payment: 'Payment',
  success: 'Done',
};

/**
 * Progress indicator — shows "current step of 5". Per Requirement 3.5 the
 * indicator MAY hide during transitions; here we hide it on the terminal
 * `success` step (which is the confirmation, not one of the five data steps).
 */
function ProgressIndicator({
  step,
  stepIndex,
}: {
  step: BookingStep;
  stepIndex: number;
}) {
  if (step === 'success') return null;

  // stepIndex is 0-based over the six steps; the five data steps are 0..4.
  const current = Math.min(stepIndex + 1, TOTAL_PROGRESS_STEPS);
  const percent = (current / TOTAL_PROGRESS_STEPS) * 100;

  return (
    <div className="mb-6 flex flex-col gap-2" aria-label="Booking progress">
      <div className="flex items-center justify-between text-sm text-base-content/70">
        <span className="font-medium">{STEP_LABELS[step]}</span>
        <span>
          Step {current} of {TOTAL_PROGRESS_STEPS}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-base-200"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={1}
        aria-valuemax={TOTAL_PROGRESS_STEPS}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * PaymentsNotSetUp — the calm "online payments aren't set up yet" state shown
 * INSTEAD of the deposit payment step when a booking requires a deposit but the
 * groomer's Stripe Connect account isn't `complete` (R17.1).
 *
 * This mirrors the server-side guard in `createDepositPaymentIntent`
 * (CONNECT_NOT_READY_ERROR) so the client never advances into a payment step
 * that can only fail — the booking is blocked here with a clear next step
 * (contact the groomer directly), surfacing their phone/email when available.
 *
 * DaisyUI theme tokens, WCAG 2.1 AA contrast, 44px touch targets.
 *
 * _Requirements: 17.1, 17.4_
 */
function PaymentsNotSetUp({
  businessName,
  phone,
  email,
  onBack,
}: {
  businessName: string;
  phone?: string;
  email?: string;
  onBack: () => void;
}) {
  const hasContact = Boolean(phone || email);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-base-content">
          Online payments aren&apos;t set up yet
        </h2>
        <p className="text-sm text-base-content/60">
          This booking requires a deposit
        </p>
      </div>

      <div className="alert alert-info rounded-2xl" role="status">
        <span>
          {businessName} hasn&apos;t enabled online payments yet, so we
          can&apos;t take your deposit here.{' '}
          {hasContact
            ? 'Please reach out to them directly to finish booking:'
            : 'Please contact them directly to finish booking your appointment.'}
        </span>
      </div>

      {hasContact && (
        <ul className="flex flex-col gap-2 text-sm text-base-content">
          {phone && (
            <li>
              <span className="font-medium">Phone: </span>
              <a
                href={`tel:${phone}`}
                className="link link-primary inline-flex min-h-11 items-center"
              >
                {phone}
              </a>
            </li>
          )}
          {email && (
            <li>
              <span className="font-medium">Email: </span>
              <a
                href={`mailto:${email}`}
                className="link link-primary inline-flex min-h-11 items-center"
              >
                {email}
              </a>
            </li>
          )}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-ghost rounded-btn min-h-11"
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </div>
  );
}

/**
 * BookingFlow — client container that drives the multi-step booking state
 * machine, renders the active step, shows a progress indicator, and animates
 * transitions between steps.
 *
 * Animated transitions use `stepTransition` from PageTransition (Framer Motion,
 * 350ms ≤ 400ms per Requirement 18.7 / 3.3). Re-mounting the animated node on
 * `currentStep` change drives the enter animation on each navigation.
 *
 * _Requirements: 3.1, 3.5, 18.7_
 */
export function BookingFlow({ groomer, initialState, prefillNotice }: BookingFlowProps) {
  const { state, dispatch } = useBookingFlow(initialState);

  const stepProps = {
    state,
    dispatch,
    services: groomer.services,
    groomerSlug: groomer.slug,
  };

  // R17 gate: a deposit booking may only proceed to the payment step when the
  // groomer can actually take the deposit. `bookingAllowed` is the shared pure
  // decision (true iff no deposit is required OR Connect is complete); when a
  // deposit IS required and payments aren't ready we must block the charge.
  const paymentsReady = groomer.paymentsReady;
  const requiresDeposit = groomer.requiresDeposit;
  const depositBookingAllowed = bookingAllowed(
    requiresDeposit,
    paymentsReady ? 'complete' : 'not_started'
  );

  function renderStep() {
    switch (state.currentStep) {
      case 'pet-info':
        return <StepPetInfo {...stepProps} />;
      case 'owner-details':
        return <StepOwnerDetails {...stepProps} />;
      case 'estimate':
        return <StepEstimate {...stepProps} />;
      case 'calendar':
        return <StepCalendar {...stepProps} />;
      case 'payment':
        // Block the deposit step when a deposit is required but online payments
        // aren't set up — show the labelled not-set-up state instead so the
        // client never reaches a dead charge (R17.1). When no deposit is
        // required, or Connect is complete, the existing StepPayment runs
        // unchanged (R17.2 / R17.3).
        if (!depositBookingAllowed) {
          return (
            <PaymentsNotSetUp
              businessName={groomer.businessName}
              phone={groomer.businessPhone}
              email={groomer.businessEmail}
              onBack={() => dispatch({ type: 'GO_BACK' })}
            />
          );
        }
        return <StepPayment {...stepProps} />;
      case 'success':
        return <StepSuccess {...stepProps} />;
      default:
        return null;
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      {prefillNotice && (
        <div className="mb-4 rounded-box border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-base-content">
          {prefillNotice}
        </div>
      )}
      <ProgressIndicator step={state.currentStep} stepIndex={state.stepIndex} />
      <Card>
        <motion.div
          key={state.currentStep}
          initial={stepTransition.initial}
          animate={stepTransition.animate}
          exit={stepTransition.exit}
          transition={stepTransition.transition}
        >
          {renderStep()}
        </motion.div>
      </Card>
    </div>
  );
}

export default BookingFlow;
