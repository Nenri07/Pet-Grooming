'use client';

import * as React from 'react';
import type { BookingStepProps } from '@/hooks/useBookingFlow';
import type { EstimateResult } from '@/types';
import { computeEstimate } from '@/actions/booking';

/**
 * StepEstimate — Step 3 of the booking flow (Instant estimate).
 *
 * On mount it calls the {@link computeEstimate} server action using the pet's
 * weight and coat condition (captured in Step 1) and the selected/first
 * service base price, then renders:
 *  - a loading state while the estimate is being computed,
 *  - the min–max range formatted as "$min.dd – $max.dd" (Requirement 5.3), or
 *  - an error message with the Confirm button DISABLED so the client cannot
 *    advance to step 4 (Requirement 5.4).
 *
 * Confirm guard (Requirement 5.5): CONFIRM_ESTIMATE is only dispatched when a
 * valid estimate is present (a result was displayed and no error occurred).
 *
 * _Requirements: 5.1, 5.3, 5.4, 5.5_
 */

/** Discriminated UI state for the estimate request. */
type EstimateUiState =
  | { status: 'loading' }
  | { status: 'ready'; estimate: EstimateResult }
  | { status: 'error'; message: string };

/** Format a numeric amount using the currency with exactly two decimals. */
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if the currency code is not recognized by Intl.
    return `$${amount.toFixed(2)}`;
  }
}

export function StepEstimate({ state, dispatch, services, groomerSlug }: BookingStepProps) {
  const [ui, setUi] = React.useState<EstimateUiState>({ status: 'loading' });

  const petInfo = state.petInfo;
  const weight = petInfo?.weight ?? null;
  const coatCondition = petInfo?.coatCondition ?? null;
  // Use the first active service's base price as the chosen/default service.
  const serviceBasePrice = services[0]?.basePrice ?? null;

  React.useEffect(() => {
    let cancelled = false;
    setUi({ status: 'loading' });

    computeEstimate({
      groomerSlug,
      petWeight: weight,
      coatCondition,
      serviceBasePrice,
    })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setUi({ status: 'ready', estimate: result.estimate });
        } else {
          setUi({ status: 'error', message: result.error });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUi({
          status: 'error',
          message: "We couldn't calculate an estimate right now. Please try again.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [groomerSlug, weight, coatCondition, serviceBasePrice]);

  const canConfirm = ui.status === 'ready';

  function handleConfirm() {
    if (ui.status !== 'ready') return;
    dispatch({ type: 'CONFIRM_ESTIMATE', payload: ui.estimate });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-base-content">Your estimate</h2>
        <p className="text-sm text-base-content/60">
          Step 3 of 5 — Instant price estimate
        </p>
      </div>

      <div className="min-h-24">
        {ui.status === 'loading' && (
          <div
            className="flex items-center gap-3 text-base-content/70"
            role="status"
            aria-live="polite"
          >
            <span className="loading loading-spinner loading-md" aria-hidden="true" />
            <span>Calculating your estimate…</span>
          </div>
        )}

        {ui.status === 'ready' && (
          <div className="flex flex-col gap-1" aria-live="polite">
            <span className="text-sm text-base-content/60">Estimated price range</span>
            <span className="text-3xl font-bold text-primary">
              {formatCurrency(ui.estimate.minPrice, ui.estimate.currency)}
              {' – '}
              {formatCurrency(ui.estimate.maxPrice, ui.estimate.currency)}
            </span>
            <span className="text-xs text-base-content/50">
              Final pricing is confirmed at your appointment.
            </span>
          </div>
        )}

        {ui.status === 'error' && (
          <div className="alert alert-error rounded-2xl" role="alert">
            <span>{ui.message}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-ghost rounded-btn"
          onClick={() => dispatch({ type: 'GO_BACK' })}
        >
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary rounded-btn"
          onClick={handleConfirm}
          disabled={!canConfirm}
        >
          Confirm estimate
        </button>
      </div>
    </div>
  );
}

export default StepEstimate;
