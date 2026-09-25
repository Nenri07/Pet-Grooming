'use client';

import * as React from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { BookingStepProps } from '@/hooks/useBookingFlow';
import { finalizeBookingByPaymentIntent } from '@/actions/booking-finalize';
import { generateBookingRef } from '@/lib/booking/reference';
import { BookingReceipt } from './BookingReceipt';
import type { ReceiptData } from './ReceiptPDF';

/**
 * StepSuccess — Step 6 of the booking flow (Confirmation / terminal step).
 *
 * On mount (once) this step calls the webhook-INDEPENDENT
 * {@link finalizeBookingByPaymentIntent} server action with the PaymentIntent
 * id captured at payment. This guarantees the booking is persisted even when
 * the Stripe webhook is delayed or not configured on the host — the webhook
 * remains the authoritative backstop and both paths share one idempotent
 * commit guarded by the Transaction unique index, so they never double-create.
 *
 * While finalising it shows a brief "finalizing your booking…" state, then
 * renders the confirmation ticket ({@link BookingReceipt}) built from the
 * server-returned summary (authoritative bookingRef) with a "Download receipt
 * (PDF)" button. If finalisation fails — or Stripe isn't configured (dev /
 * synthetic success) — it gracefully falls back to the ticket built from local
 * flow state with a generated reference, plus a non-blocking note and a retry.
 *
 * _Requirements: 7.3, 7.5, 7.6, 8.1, 8.6_
 */

/** Props for StepSuccess: the shared step props plus an optional warning flag. */
export interface StepSuccessProps extends BookingStepProps {
  /**
   * When true, some booking notifications (confirmation email, groomer email)
   * may not have been delivered. Surfaces a non-blocking warning banner.
   */
  notificationsPending?: boolean;
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

/** Finalisation lifecycle for the on-mount server call. */
type FinalizeState =
  | { status: 'finalizing' }
  | { status: 'done'; data: ReceiptData; degraded: boolean };

export function StepSuccess({
  state,
  services,
  notificationsPending,
}: StepSuccessProps) {
  const slot = state.selectedSlot;
  const payment = state.paymentResult;
  const address = state.ownerDetails?.address ?? null;

  const selectedServiceName = services.length > 0 ? services[0].name : '';
  const depositCurrency = payment?.currency ?? 'USD';

  // A locally-derived receipt built purely from flow state — used as the dev /
  // fallback ticket when the server can't confirm the booking. We keep a stable
  // generated reference across re-renders via useRef so it doesn't churn.
  const fallbackRefRef = React.useRef<string>(generateBookingRef());
  const buildLocalReceipt = React.useCallback(
    (bookingRef: string): ReceiptData => ({
      businessName: '',
      bookingRef,
      petName: state.petInfo?.name ?? '',
      serviceName: selectedServiceName,
      serviceAddress: address ? formatAddress(address) : '',
      clientName: state.ownerDetails?.name ?? '',
      scheduledDate: slot?.start ?? null,
      depositAmount: payment?.amount ?? 0,
      currency: depositCurrency,
      paymentIntentId: payment?.paymentIntentId,
      bookedOn: new Date(),
    }),
    [
      state.petInfo?.name,
      state.ownerDetails?.name,
      selectedServiceName,
      address,
      slot?.start,
      payment?.amount,
      payment?.paymentIntentId,
      depositCurrency,
    ]
  );

  const [finalize, setFinalize] = React.useState<FinalizeState>({
    status: 'finalizing',
  });

  // Guard so the finalisation effect runs exactly once per mount.
  const startedRef = React.useRef(false);
  // Allow a manual retry to re-run finalisation.
  const [retryKey, setRetryKey] = React.useState(0);

  const paymentIntentId = payment?.paymentIntentId;

  React.useEffect(() => {
    if (startedRef.current && retryKey === 0) return;
    startedRef.current = true;
    let cancelled = false;
    setFinalize({ status: 'finalizing' });

    // No real PaymentIntent (dev / synthetic success) → skip the server call
    // and show the ticket from local state with a generated reference (Req 7.6).
    if (!paymentIntentId) {
      setFinalize({
        status: 'done',
        data: buildLocalReceipt(fallbackRefRef.current),
        degraded: true,
      });
      return;
    }

    finalizeBookingByPaymentIntent(paymentIntentId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          const s = result.summary;
          setFinalize({
            status: 'done',
            degraded: false,
            data: {
              businessName: s.businessName,
              bookingRef: s.bookingRef || fallbackRefRef.current,
              petName: s.petName,
              serviceName: s.serviceName,
              serviceAddress: s.serviceAddress,
              clientName: s.clientName,
              scheduledDate: s.scheduledDate,
              depositAmount: s.depositAmount,
              currency: s.currency,
              paymentIntentId: s.paymentIntentId,
              bookedOn: new Date(),
            },
          });
        } else {
          // Finalisation could not confirm — show the local ticket gracefully.
          setFinalize({
            status: 'done',
            data: buildLocalReceipt(fallbackRefRef.current),
            degraded: true,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setFinalize({
          status: 'done',
          data: buildLocalReceipt(fallbackRefRef.current),
          degraded: true,
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentIntentId, retryKey]);

  const showWarning =
    notificationsPending ??
    Boolean(
      (payment as { notificationsPending?: boolean } | null)?.notificationsPending
    );

  if (finalize.status === 'finalizing') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-10 text-center"
        role="status"
        aria-live="polite"
      >
        <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-base-content/70">Finalizing your booking…</p>
      </div>
    );
  }

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
          Your appointment is all set. Keep your booking reference handy.
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

      {/* Graceful fallback note when the server couldn't confirm (Req 7.6). */}
      {finalize.degraded && (
        <div className="alert alert-info rounded-2xl" role="status">
          <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0" />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              We&apos;re still confirming your booking with our system. Your
              deposit went through — save your reference below.
            </span>
            {payment?.paymentIntentId && (
              <button
                type="button"
                className="btn btn-sm btn-outline min-h-[44px] self-start sm:self-auto"
                onClick={() => setRetryKey((k) => k + 1)}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      <BookingReceipt data={finalize.data} />

      <p className="text-center text-xs text-base-content/50">
        Need to make a change? Reply to your confirmation email or contact the
        groomer directly.
      </p>
    </div>
  );
}

export default StepSuccess;
