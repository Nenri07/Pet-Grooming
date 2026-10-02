'use client';

/**
 * PetCardRenderer — the on-screen Digital Pet Card plus its share actions.
 *
 * This is a client component because it owns the two interactive actions
 * (Requirements 17.3, 17.4):
 *  - "Copy Shareable Link" copies the current /pet-card/{cardId} URL to the
 *    clipboard and shows a sonner toast confirmation.
 *  - "Download as PDF" generates the A5 PDF client-side via @react-pdf/renderer
 *    and triggers a download. The PDF engine is dynamically imported only when
 *    the button is pressed, so it never bloats the initial load or SSR.
 *
 * Visuals use DaisyUI theme colors with rounded-2xl cards and a soft shadow,
 * and the layout is responsive from 320px wide (Requirements 17.1, 17.2, 17.5).
 * Service dates are strings after serialization from the server component, so
 * `nextRecommendedDate` and each history date are re-parsed for display.
 *
 * _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_
 */
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Link as LinkIcon,
  Download,
  CalendarClock,
  Loader2,
} from 'lucide-react';
import type { PetCardData } from '@/types';
import { AnimatedPetCard } from './AnimatedPetCard';

/**
 * Wire form of the card data as received by the client. Dates cross the
 * server→client boundary as ISO strings, so accept string | Date defensively.
 */
type SerializedDate = Date | string;

export interface PetCardViewData
  extends Omit<PetCardData, 'serviceHistory' | 'nextRecommendedDate'> {
  serviceHistory: Array<
    Omit<PetCardData['serviceHistory'][number], 'date'> & {
      date: SerializedDate;
    }
  >;
  nextRecommendedDate?: SerializedDate;
}

export interface PetCardRendererProps {
  /** The assembled card data (dates may be serialized to strings). */
  data: PetCardViewData;
  /** The absolute shareable URL for this card (copied to clipboard). */
  shareUrl: string;
}

/** Parse a possibly-serialized date, returning null when invalid/missing. */
function toDate(value: SerializedDate | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a date as e.g. "Jan 5, 2025". */
function formatDate(value: SerializedDate | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Rebuild the canonical `PetCardData` (with real Date objects) for the PDF. */
function toPdfData(data: PetCardViewData): PetCardData {
  return {
    ...data,
    serviceHistory: data.serviceHistory.map((entry) => ({
      ...entry,
      date: toDate(entry.date) ?? new Date(),
    })),
    nextRecommendedDate: toDate(data.nextRecommendedDate) ?? undefined,
  };
}

export function PetCardRenderer({ data, shareUrl }: PetCardRendererProps) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  async function handleCopyLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        // Fallback for browsers without the async clipboard API.
        const textarea = document.createElement('textarea');
        textarea.value = shareUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Could not copy the link. Please copy it manually.', {
        duration: Infinity,
      });
    }
  }

  async function handleDownloadPdf() {
    setIsGeneratingPdf(true);
    try {
      // Lazy-load the PDF engine + document only on demand so they stay out of
      // the initial/SSR bundle (Requirement 17.4).
      const [{ pdf }, { PetCardPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./PetCardPDF'),
      ]);

      const blob = await pdf(<PetCardPDF data={toPdfData(data)} />).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.name.replace(/[^a-z0-9-_]+/gi, '_')}-pet-card.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Pet card downloaded');
    } catch {
      toast.error('Could not generate the PDF. Please try again.', {
        duration: Infinity,
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  const nextDate = formatDate(data.nextRecommendedDate);

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* Flagship animated hero card (motion + QR + gif-like ambient life) */}
      <AnimatedPetCard data={data} shareUrl={shareUrl} />

      {/* Supporting detail: coat notes, service history, next visit */}
      <article className="mt-4 overflow-hidden rounded-2xl border border-base-content/10 bg-base-100 shadow-card">
        {data.notes && (
          <section className="border-b border-base-content/10 px-5 py-4">
            <h3 className="mb-1 text-base font-semibold text-primary">
              Coat notes
            </h3>
            <p className="text-sm text-base-content/70">{data.notes}</p>
          </section>
        )}

        {/* Service history (Requirement 17.6: omit + message when empty) */}
        <section className="px-5 py-4">
          <h3 className="mb-3 text-base font-semibold text-primary">
            Service History
          </h3>
          {data.serviceHistory.length > 0 ? (
            <ul className="space-y-3">
              {data.serviceHistory.map((entry, i) => (
                <li key={i} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium text-base-content">
                      {entry.serviceName}
                    </span>
                    <span className="text-xs text-base-content/60">
                      {formatDate(entry.date)}
                    </span>
                  </div>
                  {entry.notes && (
                    <p className="text-sm text-base-content/60">{entry.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm italic text-base-content/60">
              No services recorded yet
            </p>
          )}
        </section>

        {/* Next recommended grooming date */}
        {nextDate && (
          <section className="border-t border-base-content/10 px-5 py-4">
            <p className="inline-flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm text-base-content">
              <CalendarClock aria-hidden="true" className="h-4 w-4 text-accent" />
              <span>
                <span className="font-semibold">Next recommended visit: </span>
                {nextDate}
              </span>
            </p>
          </section>
        )}
      </article>

      {/* Share actions */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleCopyLink}
          className="btn btn-outline min-h-[44px] flex-1 gap-2"
        >
          <LinkIcon aria-hidden="true" className="h-4 w-4" />
          Copy Shareable Link
        </button>
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
          {isGeneratingPdf ? 'Preparing PDF…' : 'Download as PDF'}
        </button>
      </div>
    </div>
  );
}

export default PetCardRenderer;
