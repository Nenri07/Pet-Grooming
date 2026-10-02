'use client';

/**
 * BookingReceipt — the on-screen confirmation "ticket" plus its download
 * action, shown on the booking success step.
 *
 * The ticket visual itself lives in the shared presentational `ReceiptTicket`
 * component (so the marketing landing can render the EXACT same design). This
 * module owns the live actions: a "Download receipt (PDF)" button that
 * lazy-loads @react-pdf/renderer + ReceiptPDF and triggers a download of
 * `pawport-booking-{ref}.pdf`, and an optional "Print" button. Those buttons
 * live OUTSIDE the `#pp-receipt` article and carry `pp-no-print`, so the
 * existing `@media print` isolation prints only the receipt. All actions meet
 * the 44px touch-target minimum.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Download, Printer, Loader2 } from 'lucide-react';
import type { ReceiptData } from './ReceiptPDF';
import { ReceiptTicket } from './ReceiptTicket';

export interface BookingReceiptProps {
  data: ReceiptData;
}

export function BookingReceipt({ data }: BookingReceiptProps) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

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
      {/* Shared presentational ticket — carries id="pp-receipt" for print. */}
      <ReceiptTicket data={data} />

      {/* Actions (hidden from the printout) */}
      <div className="pp-no-print mt-4 flex flex-col gap-3 sm:flex-row">
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
