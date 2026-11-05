'use client';

/** Success screen + receipt after a card deposit on the groomer's own Stripe. */
import { BookingReceipt } from './BookingReceipt';
import type { FulfilSummary } from '@/lib/booking/fulfil';

export function PaidBookingView({ summary }: { summary: FulfilSummary }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-base-content">Booking confirmed!</h1>
        <p className="text-sm text-base-content/60">Your deposit is paid. A confirmation email is on its way.</p>
      </div>
      <BookingReceipt
        data={{
          businessName: summary.businessName,
          bookingRef: summary.bookingRef,
          petName: summary.petName,
          serviceName: summary.serviceName,
          serviceAddress: summary.serviceAddress,
          clientName: summary.clientName,
          scheduledDate: summary.scheduledDate,
          depositAmount: summary.depositAmount,
          currency: summary.currency,
          paymentIntentId: summary.paymentIntentId || undefined,
          bookedOn: new Date(),
        }}
      />
    </div>
  );
}

export default PaidBookingView;
