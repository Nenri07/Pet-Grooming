'use client';

import * as React from 'react';
import type { BookingStepProps } from '@/hooks/useBookingFlow';

/**
 * StepSuccess — Step 6 of the booking flow (Confirmation / terminal step).
 *
 * Renders the booking confirmation from state captured across the flow
 * (Requirement 8.1):
 *  - appointment date & time — from `state.selectedSlot`
 *  - selected services       — from the groomer's active `services`
 *  - service address         — from `state.ownerDetails.address`
 *  - deposit amount          — from `state.paymentResult`
 *
 * Non-blocking notification warning (Requirement 8.1): the actual emails and
 * Google Calendar event are sent server-side from the Stripe webhook AFTER the
 * records are created. If that flow detects any notification failure it can
 * surface it here via the optional `notificationsPending` prop (or an optional
 * `notificationsPending` flag on `paymentResult`). When set, we show a
 * non-blocking WARNING banner — the success page always renders regardless of
 * email/calendar outcome (Requirement 8.6).
 *
 * _Requirements: 8.1, 8.6_
 */

/** Props for StepSuccess: the shared step props plus an optional warning flag. */
export interface StepSuccessProps extends BookingStepProps {
  /**
   * When true, some booking notifications (confirmation email, groomer email,
   * or calendar event) may not have been delivered. Surfaces a non-blocking
   * warning banner. Defaults to reading an optional flag off `paymentResult`.
   */
  notificationsPending?: boolean;
}

/** Format a monetary amount with exactly two decimals, e.g. "$50.00". */
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/** Human-readable date, e.g. "Monday, June 3, 2025". */
function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Human-readable time, e.g. "10:00 AM". */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Assemble a single-line address string from the captured address parts. */
function formatAddress(address: {
  street: string;
  city: string;
  state: string;
  postalCode: string;
}): string {
  return [address.street, address.city, address.state, address.postalCode]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
}

/** A labelled detail row within the confirmation summary. */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-4">
      <span className="text-sm text-base-content/60 sm:w-36 sm:shrink-0">{label}</span>
      <span className="text-sm font-medium text-base-content">{value}</span>
    </div>
  );
}

export function StepSuccess({
  state,
  services,
  notificationsPending,
}: StepSuccessProps) {
  const slot = state.selectedSlot;
  const payment = state.paymentResult;
  const address = state.ownerDetails?.address ?? null;

  // The booking captures a single selected service (first active service,
  // consistent with StepEstimate/StepCalendar which use services[0]).
  const selectedServices = services.length > 0 ? [services[0].name] : [];

  // Allow the warning to be driven either by an explicit prop OR an optional
  // flag threaded onto paymentResult by the completion flow.
  const showWarning =
    notificationsPending ??
    Boolean((payment as { notificationsPending?: boolean } | null)?.notificationsPending);

  const depositCurrency = payment?.currency ?? 'USD';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-base-content">Booking confirmed!</h2>
        <p className="text-sm text-base-content/60">
          Your appointment is all set. A confirmation has been sent to your email.
        </p>
      </div>

      {/* Non-blocking notification warning (Requirement 8.1). */}
      {showWarning && (
        <div className="alert alert-warning rounded-2xl" role="status">
          <span>
            Your booking is confirmed, but some notifications (confirmation email
            or calendar invite) may still be pending. No action is needed on your
            part.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl bg-base-200 p-4 sm:p-5">
        {slot ? (
          <>
            <DetailRow label="Date" value={formatDate(slot.start)} />
            <DetailRow label="Time" value={formatTime(slot.start)} />
          </>
        ) : (
          <DetailRow label="Date & time" value="Details will be in your email" />
        )}

        <DetailRow
          label="Services"
          value={selectedServices.length > 0 ? selectedServices.join(', ') : '—'}
        />

        <DetailRow
          label="Service address"
          value={address ? formatAddress(address) : '—'}
        />

        <DetailRow
          label="Deposit paid"
          value={
            payment ? formatCurrency(payment.amount, depositCurrency) : '—'
          }
        />
      </div>

      <p className="text-center text-xs text-base-content/50">
        Need to make a change? Reply to your confirmation email or contact the
        groomer directly.
      </p>
    </div>
  );
}

export default StepSuccess;
