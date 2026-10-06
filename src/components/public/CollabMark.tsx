import Image from 'next/image';
import { PawPrint, X } from 'lucide-react';
import { safeHttpsImageSrc } from '@/lib/images';

/**
 * CollabMark — a compact "brand collaboration" lockup pinned to the top-right
 * of client-facing shared pages (pet card, tracker, claim, rebook).
 *
 * It reads like a fancy collab: the Pawxis wordmark/logo on the left, a small
 * "x" divider, and the GROOMER's logo on the right (falling back to a paw-print
 * tile when the groomer has no usable https logo). This replaces the full
 * marketing nav on those pages, so a client who opens a shared link sees only
 * the two brands — not the product's marketing chrome.
 *
 * Server-safe (no 'use client'); it is pure presentational markup. The groomer
 * logo src is guarded by `safeHttpsImageSrc` so a bad stored URL never crashes
 * next/image.
 */
export interface CollabMarkProps {
  /** The groomer's logo URL (any value; guarded before use). */
  groomerLogoUrl?: string | null;
  /** The groomer's business name, for the groomer logo's alt text. */
  groomerName?: string | null;
}

export function CollabMark({ groomerLogoUrl, groomerName }: CollabMarkProps) {
  const groomerSrc = safeHttpsImageSrc(groomerLogoUrl);
  const groomerLabel = groomerName?.trim() || 'Groomer';

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 sm:right-5 sm:top-5">
      <div className="flex items-center gap-2 rounded-full border border-base-content/10 bg-base-100/80 px-3 py-1.5 shadow-card backdrop-blur-md">
        {/* Pawxis brand */}
        <Image
          src="/pawxisLogo.png"
          alt="Pawxis"
          width={120}
          height={48}
          priority
          className="h-6 w-auto object-contain"
        />

        {/* x collab divider */}
        <X className="h-3.5 w-3.5 shrink-0 text-base-content/40" aria-hidden="true" />

        {/* Groomer brand */}
        {groomerSrc ? (
          <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full bg-base-100 ring-1 ring-base-content/10">
            <Image
              src={groomerSrc}
              alt={`${groomerLabel} logo`}
              fill
              className="object-cover"
              sizes="24px"
            />
          </span>
        ) : (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-base-content/10"
            aria-label={groomerLabel}
          >
            <PawPrint aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}

export default CollabMark;
