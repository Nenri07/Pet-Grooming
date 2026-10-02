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
import type { OwnerDetailsInput, PetInfoInput } from '@/types';
import { BREED_OPTIONS } from '@/config/breeds';
import { TEMPERAMENT_OPTIONS } from '@/config/temperaments';
import { COAT_CONDITION_OPTIONS } from '@/config/coat-conditions';

/** Serializable groomer info the server component passes to the flow. */
export interface BookingGroomer {
  slug: string;
  businessName: string;
  /** Optional logo image URL, surfaced in the booking page's branded header. */
  logoUrl?: string | null;
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
 * NoDepositConfirm — the Step 5 screen shown when the booking requires NO
 * deposit (deposit amount is 0, R17.2). There is nothing to charge, so instead
 * of mounting Stripe (which would otherwise show a 'payments unavailable' dead
 * end when no key is configured) we show a simple confirm action that finalises
 * the booking with a zero-amount, no-PaymentIntent result — advancing straight
 * to the confirmation/receipt step.
 */
function NoDepositConfirm({
  onConfirm,
  onBack,
}: {
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-base-content">Confirm your booking</h2>
        <p className="text-sm text-base-content/60">Step 5 of 5 — No deposit required</p>
      </div>
      <div className="alert rounded-2xl" role="status">
        <span>
          No deposit is required for this booking. Tap confirm and you&apos;re all
          set — we&apos;ll send the details to the groomer.
        </span>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost rounded-btn min-h-11" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-primary rounded-btn min-h-11 flex-1" onClick={onConfirm}>
          Confirm booking
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

  // Scroll the window to the top whenever the step changes so the user always
  // starts the next step at the top rather than scrolled near the bottom. The
  // page uses Lenis smooth scroll (via MotionProvider), which respects
  // `window.scrollTo`, so smooth behavior is fine here.
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [state.currentStep]);

  // Dev-only autofill: fills pet-info + owner-details with valid dummy data and
  // advances to the estimate step so testers can click through quickly. The
  // values are the FIRST option from each config list, guaranteeing they
  // satisfy the booking zod schemas. Only rendered outside production builds.
  const isDev = process.env.NODE_ENV !== 'production';
  function handleAutofill() {
    const dummyPet: PetInfoInput = {
      name: 'Bella',
      breed: BREED_OPTIONS[0].value,
      weight: 20,
      weightUnit: 'lbs',
      age: 3,
      temperament: TEMPERAMENT_OPTIONS[0].value,
      coatCondition: COAT_CONDITION_OPTIONS[0].value,
      specialFlags: [],
      notes: '',
    };
    const dummyOwner: OwnerDetailsInput = {
      name: 'Test Owner',
      email: 'test@example.com',
      phone: '+15551234567',
      address: {
        street: '123 Main St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
      },
    };
    dispatch({ type: 'SUBMIT_PET_INFO', payload: dummyPet });
    dispatch({ type: 'SUBMIT_OWNER_DETAILS', payload: dummyOwner, smsConsent: false });
  }

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
        // No deposit required (R17.2): nothing to charge, so skip Stripe
        // entirely and confirm the booking straight through to success —
        // otherwise StepPayment would show a 'payments unavailable' dead end.
        if (!requiresDeposit) {
          return (
            <NoDepositConfirm
              onBack={() => dispatch({ type: 'GO_BACK' })}
              onConfirm={() =>
                dispatch({
                  type: 'PAYMENT_SUCCESS',
                  payload: {
                    paymentIntentId: '',
                    status: 'succeeded',
                    amount: 0,
                    currency: 'USD',
                  },
                })
              }
            />
          );
        }
        // Block the deposit step when a deposit is required but online payments
        // aren't set up — show the labelled not-set-up state instead so the
        // client never reaches a dead charge (R17.1). When Connect is
        // complete, the existing StepPayment runs unchanged (R17.3).
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
      {isDev && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={handleAutofill}
          >
            ⚡ Autofill (dev)
          </button>
        </div>
      )}
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
