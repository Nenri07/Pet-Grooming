'use client';

/**
 * PetCardRenderer — the on-screen Digital Pet Card plus its share actions.
 *
 * This is a client component because it owns the two interactive actions
 * (Requirements 17.3, 17.4):
 *  - "Copy Shareable Link" copies the current /pet-card/{cardId} URL to the
 *    clipboard and shows a sonner toast confirmation.
 *  - "Share card" records the live animated card as a GIF in the browser and
 *    opens the phone's share sheet (WhatsApp, Facebook, X, …). Where sharing
 *    files isn't supported it saves the GIF instead. Quick link-share buttons
 *    for Facebook / WhatsApp / X sit underneath.
 *
 * Visuals use DaisyUI theme colors with rounded-2xl cards and a soft shadow,
 * and the layout is responsive from 320px wide (Requirements 17.1, 17.2, 17.5).
 * Service dates are strings after serialization from the server component, so
 * `nextRecommendedDate` and each history date are re-parsed for display.
 *
 * _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_
 */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Link as LinkIcon,
  Share2,
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

export function PetCardRenderer({ data, shareUrl }: PetCardRendererProps) {
  const [isSharing, setIsSharing] = useState(false);
  const cardWrapRef = useRef<HTMLDivElement>(null);
  const shareText = `${data.name}'s pet card${data.branding?.businessName ? ` from ${data.branding.businessName}` : ''}`;

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

  async function handleShareCard() {
    // Record the card itself (the <article>), not the centred wrapper around it.
    const node =
      (cardWrapRef.current?.querySelector('article') as HTMLElement | null) ??
      (cardWrapRef.current?.firstElementChild as HTMLElement | null);
    if (!node) return;
    setIsSharing(true);
    try {
      const { recordNodeAsGif } = await import('@/lib/pet-card/record-gif');
      const blob = await recordNodeAsGif(node);
      const fileName = `${data.name.replace(/[^a-z0-9-_]+/gi, '_')}-pet-card.gif`;
      const file = new File([blob], fileName, { type: 'image/gif' });

      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: shareText, text: `${shareText} ${shareUrl}` });
          return;
        } catch (err) {
          // The user closed the share sheet: that's not an error.
          if ((err as { name?: string })?.name === 'AbortError') return;
        }
      }

      // No file sharing (most desktops): save the GIF so it can be posted.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('GIF saved. Post it from your gallery or downloads.');
    } catch {
      toast.error('Could not create the GIF. Please try again.');
    } finally {
      setIsSharing(false);
    }
  }

  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(shareText);
  const socialLinks = [
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodedText}%20${encodedUrl}` },
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}` },
  ];

  const nextDate = formatDate(data.nextRecommendedDate);

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* Flagship animated hero card (motion + QR + gif-like ambient life) */}
      <div ref={cardWrapRef}>
        <AnimatedPetCard data={data} shareUrl={shareUrl} />
      </div>

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
          onClick={handleShareCard}
          disabled={isSharing}
          className="btn btn-primary min-h-[44px] flex-1 gap-2"
        >
          {isSharing ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Share2 aria-hidden="true" className="h-4 w-4" />
          )}
          {isSharing ? 'Making your GIF…' : 'Share card (GIF)'}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="text-base-content/60">Or share the link:</span>
        {socialLinks.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm min-h-[44px]"
          >
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export default PetCardRenderer;
