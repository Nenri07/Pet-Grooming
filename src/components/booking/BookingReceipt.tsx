'use client';

/**
 * BookingReceipt — the on-screen confirmation "ticket" plus its download
 * action, shown on the booking success step.
 *
 * Visuals use DaisyUI theme tokens (primary/accent gradient header, a big
 * boxed reference number, rounded surfaces) so it inherits the site theme —
 * no literal colors here. The "Download receipt (PDF)" button lazy-loads
 * @react-pdf/renderer + ReceiptPDF and triggers a download of
 * `pawport-booking-{ref}.pdf`, reusing the exact PetCardRenderer pattern so the
 * PDF engine stays out of the initial/SSR bundle. An optional "Print" button
 * calls window.print(). All actions meet the 44px touch-target minimum.
 */
import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import {
  PawPrint,
  Download,
  Printer,
  Loader2,
  CalendarDays,
  Clock,
  MapPin,
  Scissors,
  User,
  CheckCircle2,
} from 'lucide-react';
import type { ReceiptData } from './ReceiptPDF';

export interface BookingReceiptProps {
  data: ReceiptData;
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

/** A single labelled row in the details grid. */
function Detail({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-primary" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs text-base-content/60">{label}</div>
        <div className="text-sm font-medium text-base-content">{value}</div>
      </div>
    </div>
  );
}

export function BookingReceipt({ data }: BookingReceiptProps) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const dateStr = formatDate(data.scheduledDate);
  const timeStr = formatTime(data.scheduledDate);

  async function handleDownloadPdf() {
    setIsGeneratingPdf(true);
    try {
      // Lazy-load the PDF engine + document only on demand so they stay out of
      // the initial/SSR bundle (mirrors PetCardRenderer).
      const [{ pdf }, { ReceiptPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./ReceiptPDF'),
      ]);

      const blob = await pdf(<ReceiptPDF data={data} />).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeRef = (data.bookingRef || 'receipt').replace(/[^a-z0-9-_]+/gi, '_');
      link.download = `pawport-booking-${safeRef}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Receipt downloaded');
    } catch {
      toast.error('Could not generate the receipt. Please try again.', {
        duration: Infinity,
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  function handlePrint() {
    if (typeof window !== 'undefined') window.print();
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <article className="overflow-hidden rounded-2xl bg-base-100 shadow-card">
        {/* Gradient / accent header */}
        <header className="flex items-center gap-3 bg-gradient-to-r from-primary to-accent px-5 py-4 text-primary-content">
          {data.logoUrl ? (
            <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-base-100/20">
              <Image
                src={data.logoUrl}
                alt={`${data.businessName || 'Business'} logo`}
                fill
                className="object-cover"
                sizes="44px"
              />
            </span>
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-base-100/20">
              <PawPrint aria-hidden="true" className="h-6 w-6" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold">
              {data.businessName || 'Pet Grooming'}
            </h3>
            <p className="text-xs opacity-90">Booking Confirmation</p>
          </div>
        </header>

        {/* Prominent, boxed reference number */}
        <div className="px-5 pt-5">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-4 text-center">
            <div className="text-[0.65rem] font-semibold uppercase tracking-widest text-primary/70">
              Booking Reference
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-widest text-primary">
              {data.bookingRef || '—'}
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-1 gap-3 px-5 py-5 sm:grid-cols-2">
          <Detail
            icon={<CalendarDays className="h-4 w-4" />}
            label="Date"
            value={dateStr || 'In your email'}
          />
          <Detail icon={<Clock className="h-4 w-4" />} label="Time" value={timeStr} />
          <Detail
            icon={<PawPrint className="h-4 w-4" />}
            label="Pet"
            value={data.petName}
          />
          <Detail
            icon={<Scissors className="h-4 w-4" />}
            label="Service"
            value={data.serviceName}
          />
          <Detail
            icon={<User className="h-4 w-4" />}
            label="Client"
            value={data.clientName}
          />
          <Detail
            icon={<MapPin className="h-4 w-4" />}
            label="Service address"
            value={data.serviceAddress}
          />
        </div>

        {/* Deposit paid + status */}
        <div className="mx-5 mb-5 flex items-center justify-between gap-3 rounded-2xl border border-base-300 px-4 py-3">
          <div>
            <div className="text-lg font-bold text-base-content">
              {formatCurrency(data.depositAmount, data.currency)}
            </div>
            <div className="text-xs text-base-content/60">
              Deposit paid ({data.currency.toUpperCase()})
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
            Deposit received
          </span>
        </div>

        {data.paymentIntentId && (
          <p className="px-5 pb-4 text-[0.65rem] text-base-content/40">
            Payment ID: {data.paymentIntentId}
          </p>
        )}

        <p className="border-t border-base-300 px-5 py-3 text-center text-xs text-base-content/60">
          Present this reference when your groomer arrives.
        </p>
      </article>

      {/* Actions */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={isGeneratingPdf}
          className="btn btn-primary min-h-[44px] flex-1 gap-2"
        >
          {isGeneratingPdf ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Download aria-hidden="true" className="h-4 w-4" />
          )}
          {isGeneratingPdf ? 'Preparing receipt…' : 'Download receipt (PDF)'}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="btn btn-outline min-h-[44px] gap-2 sm:flex-none"
        >
          <Printer aria-hidden="true" className="h-4 w-4" />
          Print
        </button>
      </div>
    </div>
  );
}

export default BookingReceipt;
