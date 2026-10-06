'use client';

/**
 * ReceiptTicket — the shared, presentational booking-receipt "ticket".
 *
 * This is the EXACT premium on-screen receipt visual (the `#pp-receipt`
 * <article>) extracted so it can be rendered in two places without drift:
 *   - `BookingReceipt` renders it on the booking success step and wraps it with
 *     the live Download / Print action buttons (kept OUTSIDE this article so the
 *     `@media print` isolation on `#pp-receipt` still prints only the ticket).
 *   - `ReceiptShowcase` on the marketing landing renders it with sample data so
 *     prospects see the real design they'll get — no action buttons.
 *
 * Visuals use DaisyUI theme tokens only (primary/accent, base-*, success) so it
 * recolours with every theme. It carries `id="pp-receipt"` so the existing
 * print stylesheet keeps isolating it. Responsive from 320px.
 */
import Image from 'next/image';
import { PawPrint, CheckCircle2 } from 'lucide-react';
import type { ReceiptData } from './ReceiptPDF';
import { safeHttpsImageSrc } from '@/lib/images';

export interface ReceiptTicketProps {
  data: ReceiptData;
  /**
   * Optional override for the article id. Defaults to `pp-receipt` so the live
   * receipt keeps its print isolation. The showcase passes a different id to
   * avoid duplicate ids if both ever render on the same page.
   */
  id?: string;
}

/** Parse a possibly-serialized date, returning null when invalid/missing. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Human-readable date, e.g. "Monday, June 3, 2025". */
function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Human-readable time, e.g. "10:00 AM". */
function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format a monetary amount, e.g. "$50.00". */
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/** Short issue date, e.g. "Jun 3, 2025". */
function formatIssueDate(value: string | Date | null | undefined): string {
  const date = toDate(value) ?? new Date();
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The premium receipt ticket. Purely presentational — no actions, no state —
 * so it can be shared by the live success step and the marketing showcase.
 */
export function ReceiptTicket({ data, id = 'pp-receipt' }: ReceiptTicketProps) {
  const dateStr = formatDate(data.scheduledDate);
  const timeStr = formatTime(data.scheduledDate);
  const issueDate = formatIssueDate(data.bookedOn);
  const whenLine = [dateStr, timeStr].filter(Boolean).join(' · ');

  // When the caller supplies the full service price, surface the balance still
  // owed on the day (price − deposit). Additive: deposit-only bookings show 0.
  const balanceDue =
    typeof data.servicePrice === 'number' &&
    Number.isFinite(data.servicePrice) &&
    data.servicePrice > data.depositAmount
      ? data.servicePrice - data.depositAmount
      : 0;

  return (
    <article
      id={id}
      className="overflow-hidden rounded-box border border-base-content/10 bg-base-100 shadow-card"
    >
      {/* Header band: Pawxis logo + business name, with document title */}
      <header className="flex items-center justify-between gap-3 bg-base-200/60 px-6 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-base-100 shadow-card">
            <Image
              src="/pawxisLogo.png"
              alt="Pawxis"
              fill
              className="object-contain p-1"
              sizes="48px"
            />
          </span>
          {safeHttpsImageSrc(data.logoUrl) && (
            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-base-100">
              <Image
                src={safeHttpsImageSrc(data.logoUrl) as string}
                alt={`${data.businessName || 'Business'} logo`}
                fill
                className="object-cover"
                sizes="40px"
              />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-base-content">
              {data.businessName || 'Pet Grooming'}
            </h3>
            <p className="text-xs text-base-content/50">Powered by Pawxis</p>
          </div>
        </div>
        <span className="shrink-0 text-right text-[0.6rem] font-semibold uppercase leading-tight tracking-[0.2em] text-primary">
          Booking
          <br />
          Receipt
        </span>
      </header>

      {/* Accent band — recolors with the active theme */}
      <div aria-hidden="true" className="h-1 bg-primary" />

      <div className="px-6 py-6">
        {/* Invoice meta: reference no. + issue date */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-base-content/50">
              Reference
            </div>
            <div className="mt-1 font-mono text-xl font-bold tracking-widest text-primary">
              {data.bookingRef || '—'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-base-content/50">
              Issued
            </div>
            <div className="mt-1 text-sm font-semibold text-base-content">
              {issueDate}
            </div>
          </div>
        </div>

        {/* Billed to */}
        {(data.clientName || data.serviceAddress) && (
          <div className="mt-6 border-t border-base-content/10 pt-4">
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-base-content/50">
              Billed to
            </div>
            {data.clientName && (
              <div className="mt-1 text-sm font-semibold text-base-content">
                {data.clientName}
              </div>
            )}
            {data.serviceAddress && (
              <div className="text-sm text-base-content/60">
                {data.serviceAddress}
              </div>
            )}
          </div>
        )}

        {/* Itemized line: service — date/time — amount */}
        <div className="mt-6 overflow-hidden rounded-box border border-base-content/10">
          <div className="flex items-center justify-between gap-3 bg-base-200/60 px-4 py-2.5">
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-base-content/50">
              Description
            </span>
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-base-content/50">
              Amount
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 px-4 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
                <PawPrint
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-primary"
                />
                <span className="truncate">
                  {data.serviceName || 'Grooming service'}
                </span>
              </div>
              <div className="mt-1 pl-6 text-xs text-base-content/60">
                {data.petName ? `${data.petName} · ` : ''}
                {whenLine || 'Scheduled — details in your email'}
              </div>
              <div className="mt-1 pl-6 text-xs text-base-content/50">
                Deposit toward total
              </div>
            </div>
            <div className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-base-content">
              {formatCurrency(data.depositAmount, data.currency)}
            </div>
          </div>
        </div>

        {/* Totals block */}
        <div className="mt-5 space-y-2 border-t border-base-content/10 pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-base-content/60">Deposit received</span>
            <span className="font-mono tabular-nums text-base-content">
              {formatCurrency(data.depositAmount, data.currency)}
            </span>
          </div>
          {balanceDue > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-base-content/60">Balance due on the day</span>
              <span className="font-mono tabular-nums text-base-content">
                {formatCurrency(balanceDue, data.currency)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-base-content/10 pt-3">
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-base-content/50">
                Paid today
              </div>
              <div className="text-lg font-bold text-base-content">
                {formatCurrency(data.depositAmount, data.currency)}
                <span className="ml-1 text-xs font-normal text-base-content/50">
                  {data.currency.toUpperCase()}
                </span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
              Deposit received
            </span>
          </div>
        </div>

        {data.paymentIntentId && (
          <p className="mt-4 font-mono text-[0.65rem] text-base-content/40">
            Payment ID: {data.paymentIntentId}
          </p>
        )}
      </div>

      <p className="border-t border-base-content/10 bg-base-200/40 px-6 py-3 text-center text-xs text-base-content/60">
        Present this reference when your groomer arrives.
      </p>
    </article>
  );
}

export default ReceiptTicket;
