'use client';

/**
 * BeforeAfterCard — branded 1080×1350 split share card (Master Spec §11.3).
 *
 * Renders a portrait card (before | after split, pet name, groomer logo, "Book
 * at {url}"), then uses `html-to-image` to rasterise the DOM node to a PNG.
 * Buttons: Share (`navigator.share`), Download, Add to Pet Card.
 *
 * The Pro gate is enforced server-side on the save action; this component is
 * only rendered once both photos exist (the panel gates that), and "Add to Pet
 * Card" calls the Pro-gated server action which re-checks entitlement.
 *
 * Theme tokens only; the card itself uses fixed export dimensions (a social
 * asset), scaled down for on-screen preview.
 *
 * _Master Spec: §11.3_
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Download, Share2, PawPrint, Heart } from 'lucide-react';
import { addAfterPhotoToPetCard } from '@/actions/before-after';

interface BeforeAfterCardProps {
  appointmentId: string;
  petName: string | null;
  beforePhotoUrl: string;
  afterPhotoUrl: string;
  business: string;
  logoUrl: string | null;
  bookingUrl: string | null;
}

/** Export dimensions for the social card (§11.3: 1080×1350 portrait). */
const CARD_W = 1080;
const CARD_H = 1350;

export function BeforeAfterCard({
  appointmentId,
  petName,
  beforePhotoUrl,
  afterPhotoUrl,
  business,
  logoUrl,
  bookingUrl,
}: BeforeAfterCardProps) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [addingToCard, setAddingToCard] = React.useState(false);

  /** Rasterise the card node to a PNG data URL via html-to-image. */
  const toPng = React.useCallback(async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    const { toPng: htmlToPng } = await import('html-to-image');
    return htmlToPng(cardRef.current, {
      width: CARD_W,
      height: CARD_H,
      pixelRatio: 1,
      cacheBust: true,
    });
  }, []);

  const download = React.useCallback(async () => {
    setBusy(true);
    try {
      const dataUrl = await toPng();
      if (!dataUrl) return;
      const link = document.createElement('a');
      link.download = `${(petName ?? 'pet').toLowerCase().replace(/\s+/g, '-')}-before-after.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      toast.error('Could not generate the image. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [toPng, petName]);

  const share = React.useCallback(async () => {
    setBusy(true);
    try {
      const dataUrl = await toPng();
      if (!dataUrl) return;
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'before-after.png', { type: 'image/png' });

      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `${petName ?? 'Pet'} · ${business}`,
          text: bookingUrl ? `Book at ${bookingUrl}` : undefined,
        });
      } else {
        // No Web Share for files → fall back to download.
        await download();
        toast.info('Sharing is not supported here — the image was downloaded instead.');
      }
    } catch (err) {
      // A user-cancelled share throws AbortError; ignore it quietly.
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Could not share the image. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }, [toPng, download, petName, business, bookingUrl]);

  const addToPetCard = React.useCallback(async () => {
    setAddingToCard(true);
    try {
      const res = await addAfterPhotoToPetCard(appointmentId);
      if (res.ok) {
        toast.success('Added to the pet card.');
      } else {
        toast.error(res.error);
      }
    } finally {
      setAddingToCard(false);
    }
  }, [appointmentId]);

  return (
    <div className="flex flex-col gap-4">
      {/* On-screen preview: the export card scaled down. The inner node keeps
          its true 1080×1350 size so html-to-image exports at full resolution. */}
      <div className="mx-auto w-full max-w-[270px] overflow-hidden rounded-box border border-base-content/10 shadow-card">
        <div
          style={{
            width: CARD_W,
            height: CARD_H,
            transform: `scale(${270 / CARD_W})`,
            transformOrigin: 'top left',
          }}
        >
          <div
            ref={cardRef}
            className="flex flex-col bg-base-100"
            style={{ width: CARD_W, height: CARD_H }}
          >
            {/* Split photos */}
            <div className="relative flex flex-1">
              <div className="relative w-1/2 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={beforePhotoUrl}
                  alt="Before"
                  crossOrigin="anonymous"
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-6 top-6 rounded-badge bg-base-100/90 px-4 py-1.5 text-2xl font-semibold text-base-content">
                  Before
                </span>
              </div>
              <div className="relative w-1/2 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={afterPhotoUrl}
                  alt="After"
                  crossOrigin="anonymous"
                  className="h-full w-full object-cover"
                />
                <span className="absolute right-6 top-6 rounded-badge bg-primary px-4 py-1.5 text-2xl font-semibold text-primary-content">
                  After
                </span>
              </div>
            </div>

            {/* Branded footer */}
            <div className="flex items-center gap-5 bg-hero px-10 py-8">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={business}
                  crossOrigin="anonymous"
                  className="h-24 w-24 rounded-full object-cover ring-4 ring-base-100"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-base-100 text-primary ring-4 ring-base-100">
                  <PawPrint className="h-12 w-12" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0">
                {petName && (
                  <p className="truncate font-display text-4xl font-bold text-base-content">
                    {petName}
                  </p>
                )}
                <p className="truncate text-3xl font-semibold text-base-content/80">
                  {business}
                </p>
                {bookingUrl && (
                  <p className="mt-1 truncate text-2xl text-primary">
                    Book at {bookingUrl.replace(/^https?:\/\//, '')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void share()}
          disabled={busy}
          className="btn btn-primary min-h-[44px]"
        >
          <Share2 className="h-5 w-5" aria-hidden="true" />
          {busy ? 'Working…' : 'Share'}
        </button>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="btn btn-outline min-h-[44px]"
        >
          <Download className="h-5 w-5" aria-hidden="true" />
          Download
        </button>
        <button
          type="button"
          onClick={() => void addToPetCard()}
          disabled={addingToCard}
          className="btn btn-ghost min-h-[44px]"
        >
          <Heart className="h-5 w-5" aria-hidden="true" />
          {addingToCard ? 'Adding…' : 'Add to Pet Card'}
        </button>
      </div>
    </div>
  );
}

export default BeforeAfterCard;
