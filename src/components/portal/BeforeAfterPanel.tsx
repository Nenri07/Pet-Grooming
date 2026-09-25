'use client';

/**
 * BeforeAfterPanel — appointment before/after upload + share card (Master Spec §11.3).
 *
 * Hosts two Cloudinary {@link ImageUpload}s (before + after, mobile camera
 * capable). Each completed upload is persisted onto the appointment via the
 * Pro-gated {@link savePhoto} server action. Once BOTH photos exist, the
 * branded {@link BeforeAfterCard} renders with Share / Download / Add to Pet
 * Card.
 *
 * The `beforeAfter` Pro gate is authoritative on `savePhoto` server-side; if a
 * save comes back `locked`, the panel shows an upgrade hint.
 *
 * _Master Spec: §11.3, §13.1_
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Camera, Lock } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { savePhoto, type PhotoKind } from '@/actions/before-after';
import { BeforeAfterCard } from '@/components/portal/BeforeAfterCard';

interface BeforeAfterPanelProps {
  appointmentId: string;
  petName: string | null;
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  business: string;
  logoUrl: string | null;
  bookingUrl: string | null;
}

export function BeforeAfterPanel({
  appointmentId,
  petName,
  beforePhotoUrl,
  afterPhotoUrl,
  business,
  logoUrl,
  bookingUrl,
}: BeforeAfterPanelProps) {
  const [before, setBefore] = React.useState<string | null>(beforePhotoUrl);
  const [after, setAfter] = React.useState<string | null>(afterPhotoUrl);
  const [locked, setLocked] = React.useState(false);

  const persist = React.useCallback(
    async (kind: PhotoKind, url: string) => {
      const res = await savePhoto(appointmentId, kind, url);
      if (res.ok) {
        if (kind === 'before') setBefore(url);
        else setAfter(url);
        toast.success(`${kind === 'before' ? 'Before' : 'After'} photo saved.`);
        return;
      }
      if ('locked' in res && res.locked) {
        setLocked(true);
      }
      toast.error(res.error);
    },
    [appointmentId]
  );

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-base-content">
        <Camera className="h-5 w-5 text-primary" aria-hidden="true" />
        Before &amp; After
        {locked && <Lock className="ml-auto h-4 w-4 text-base-content/40" aria-hidden="true" />}
      </h2>
      <p className="mb-4 text-sm text-base-content/60">
        Snap a before and after, then share a branded card.
      </p>

      {locked ? (
        <div className="rounded-box bg-base-200 p-4 text-center">
          <p className="font-medium text-base-content">A Pro feature</p>
          <p className="mt-1 text-sm text-base-content/60">
            Create branded before/after share cards to win new clients.
          </p>
          <Link href="/billing" className="btn btn-primary btn-sm mt-3 min-h-[44px]">
            Upgrade to Pro
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-base-content/70">Before</p>
              <ImageUpload
                context="petPhoto"
                value={before ?? undefined}
                onChange={(url) => void persist('before', url)}
                label="Add before photo"
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-base-content/70">After</p>
              <ImageUpload
                context="petPhoto"
                value={after ?? undefined}
                onChange={(url) => void persist('after', url)}
                label="Add after photo"
              />
            </div>
          </div>

          {before && after && (
            <div className="mt-6 border-t border-base-content/10 pt-6">
              <p className="mb-3 text-sm font-medium text-base-content/70">Share card</p>
              <BeforeAfterCard
                appointmentId={appointmentId}
                petName={petName}
                beforePhotoUrl={before}
                afterPhotoUrl={after}
                business={business}
                logoUrl={logoUrl}
                bookingUrl={bookingUrl}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default BeforeAfterPanel;
