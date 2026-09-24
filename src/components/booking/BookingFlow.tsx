'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { stepTransition } from '@/components/ui/PageTransition';
import {
  useBookingFlow,
  TOTAL_PROGRESS_STEPS,
  type BookingStep,
  type BookingStepServices,
} from '@/hooks/useBookingFlow';
import { StepPetInfo } from './StepPetInfo';
import { StepOwnerDetails } from './StepOwnerDetails';
import { StepEstimate } from './StepEstimate';
import { StepCalendar } from './StepCalendar';
import { StepPayment } from './StepPayment';
import { StepSuccess } from './StepSuccess';

/** Serializable groomer info the server component passes to the flow. */
export interface BookingGroomer {
  slug: string;
  businessName: string;
  services: BookingStepServices;
}

interface BookingFlowProps {
  groomer: BookingGroomer;
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
export function BookingFlow({ groomer }: BookingFlowProps) {
  const { state, dispatch } = useBookingFlow();

  const stepProps = {
    state,
    dispatch,
    services: groomer.services,
    groomerSlug: groomer.slug,
  };

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
        return <StepPayment {...stepProps} />;
      case 'success':
        return <StepSuccess {...stepProps} />;
      default:
        return null;
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl">
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
