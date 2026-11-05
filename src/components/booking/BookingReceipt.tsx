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
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Printer, Loader2 } from 'lucide-react';
import type { ReceiptData } from './ReceiptPDF';
import { ReceiptTicket } from './ReceiptTicket';

export interface BookingReceiptProps {
  data: ReceiptData;
}

/** CSS px → PDF points (96 dpi screen → 72 dpi PDF). */
const PX_TO_PT = 0.75;

export function BookingReceipt({ data }: BookingReceiptProps) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const ticketWrapRef = useRef<HTMLDivElement>(null);

  /** The on-screen receipt article (the exact visual the client sees). */
  function ticketNode(): HTMLElement | null {
    return ticketWrapRef.current?.querySelector('article') ?? null;
  }

  /**
   * Snapshot the on-screen receipt to a high-resolution PNG so the download is
   * pixel-identical to the view (theme colours, fonts, logos, layout).
   */
  async function captureTicket(): Promise<{ dataUrl: string; width: number; height: number } | null> {
    const node = ticketNode();
    if (!node) return null;
    const { toPng } = await import('html-to-image');
    const rect = node.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    const dataUrl = await toPng(node, {
      width,
      height,
      pixelRatio: 3,
      cacheBust: true,
      backgroundColor: getComputedStyle(node).backgroundColor,
    });
    return { dataUrl, width, height };
  }

  async function handleDownloadPdf() {
    setIsGeneratingPdf(true);
    try {
      // Lazy-load the PDF engine only on demand so it stays out of the
      // initial/SSR bundle (mirrors PetCardRenderer).
      const reactPdf = await import('@react-pdf/renderer');
      const { pdf, Document, Page, Image } = reactPdf;

      let blob: Blob;
      const shot = await captureTicket().catch(() => null);
      if (shot) {
        // One page sized exactly to the receipt, holding the snapshot.
        const w = shot.width * PX_TO_PT;
        const h = shot.height * PX_TO_PT;
        blob = await pdf(
          <Document title={`Receipt ${data.bookingRef}`} author={data.businessName || 'Pawxis'}>
            <Page size={{ width: w, height: h }} style={{ padding: 0 }}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not <img> */}
              <Image src={shot.dataUrl} style={{ width: w, height: h }} />
            </Page>
          </Document>
        ).toBlob();
      } else {
        // Fallback: the drawn receipt document if the snapshot fails.
        const { ReceiptPDF } = await import('./ReceiptPDF');
        blob = await pdf(<ReceiptPDF data={data} />).toBlob();
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeRef = (data.bookingRef || 'receipt').replace(/[^a-z0-9-_]+/gi, '_');
      link.download = `pawxis-booking-${safeRef}.pdf`;
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
    if (typeof window === 'undefined') return;
    // Print at the same width as on screen so text wraps identically; the
    // print stylesheet reads this variable (see globals.css #pp-receipt).
    const node = ticketNode();
    if (node) {
      node.style.setProperty('--pp-receipt-w', `${Math.ceil(node.getBoundingClientRect().width)}px`);
      window.addEventListener(
        'afterprint',
        () => node.style.removeProperty('--pp-receipt-w'),
        { once: true }
      );
    }
    window.print();
  }

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Shared presentational ticket — carries id="pp-receipt" for print. */}
      <div ref={ticketWrapRef}>
        <ReceiptTicket data={data} />
      </div>

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
