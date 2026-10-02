'use client';
import * as React from 'react';
import Image from 'next/image';
import { useGsapContext, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { images } from '@/content/images.generated';
import { AnimatedPetCard } from '@/components/pet-card/AnimatedPetCard';
import type { PetCardViewData } from '@/components/pet-card/PetCardRenderer';

/**
 * PetCardShowcase (Section 7.6) — renders the REAL flagship
 * `<AnimatedPetCard>` with realistic sample data as the hero of the section,
 * so prospects see the actual animated card (ambient motion, QR, letter-by-
 * letter name reveal) their clients get — not a simplified mockup. A
 * Before/After slider sits beside it as a secondary visual.
 *
 * Motion ownership (kept strictly separated so no two owners fight):
 *   - AnimatedPetCard owns its own Framer motion internally (hover spring,
 *     pointer tilt, name reveal, ambient drift) and is reduced-motion safe.
 *   - A dedicated decorative layer behind the before/after image gets a GSAP
 *     parallax float; it is a separate node from the image the slider clips.
 *
 * Reduced motion: the card renders its final static state (handled internally),
 * and the decorative layer is static. The range slider still works on demand.
 *
 * "Illustrative example" captions make clear these are not a real customer.
 */

/** Realistic sample pet-card data — the exact shape the real card renders. */
const SAMPLE_CARD: PetCardViewData = {
  cardId: 'demo-bella',
  name: 'Bella',
  breed: 'Cockapoo',
  weight: 9,
  weightUnit: 'kg',
  age: 3,
  temperament: 'calm',
  coatCondition: 'curly',
  photoUrl: images.featureCard.src,
  notes: 'Loves a teddy-bear trim. A little ticklish around the paws.',
  specialFlags: ['Sensitive skin', 'Gentle handling'],
  serviceHistory: [
    {
      date: '2025-06-12',
      serviceName: 'Full groom · Teddy trim',
      status: 'completed',
    },
    {
      date: '2025-05-08',
      serviceName: 'Bath & tidy',
      status: 'completed',
    },
  ],
  nextRecommendedDate: '2025-07-17',
  branding: {
    businessName: 'Happy Paws',
    logoUrl: '/pawxis2.png',
  },
};

/** A valid shareable URL for the QR code (demo path). */
const SAMPLE_SHARE_URL = `${
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pawxis.com'
}/pet-card/demo-bella`;

export function PetCardShowcase() {
  const [pos, setPos] = React.useState(50);

  // GSAP parallax on the decorative layer only (never the clipped image).
  const decoRef = useGsapContext(({ gsap, reduced: r, scope }) => {
    if (r) return;
    const layer = scope.querySelector<HTMLElement>('[data-deco-layer]');
    if (!layer) return;
    gsap.to(layer, {
      yPercent: -14,
      ease: 'none',
      scrollTrigger: {
        trigger: scope,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  });

  return (
    <section aria-labelledby="petcard-heading" className="bg-base-100">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          titleId="petcard-heading"
          eyebrow="Looks like a big brand"
          title="Every pet gets a shareable animated card"
          subtitle="Coat, temperament and past styles travel with every pet on a living Digital Pet Card — one tap to share, scan or download."
        />

        <div
          ref={decoRef as React.RefObject<HTMLDivElement>}
          className="relative mt-14 grid items-center gap-12 lg:grid-cols-2"
        >
          {/* ---- The REAL animated Digital Pet Card (hero of the section) ---- */}
          <div className="flex flex-col items-center">
            <AnimatedPetCard data={SAMPLE_CARD} shareUrl={SAMPLE_SHARE_URL} />
            <p className="mt-4 text-center text-sm font-medium text-base-content/70">
              This is the real card your clients get
            </p>
            <p className="mt-1 text-center text-[0.7rem] text-base-content/50">
              Illustrative example
            </p>
          </div>

          {/* ---- Before/After slider (secondary visual) ---- */}
          <div className="relative">
            {/* Decorative parallax layer (GSAP-owned, separate from the image). */}
            <div
              aria-hidden
              data-deco-layer
              className="pointer-events-none absolute -right-6 -top-8 -z-0 h-40 w-40 rounded-full bg-primary/10 blur-2xl"
            />
            <div className="relative aspect-square w-full overflow-hidden rounded-box border border-base-content/10 shadow-card">
              {/* Before (base layer) */}
              <Image
                src={images.before.src}
                alt={images.before.alt}
                fill
                loading="lazy"
                sizes="(max-width: 1024px) 90vw, 500px"
                placeholder="blur"
                blurDataURL={images.before.blurDataURL}
                className="object-cover"
              />
              {/* After (clipped by slider position) */}
              <div
                className="absolute inset-0 transition-[clip-path] duration-150 ease-out"
                style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
              >
                <Image
                  src={images.after.src}
                  alt={images.after.alt}
                  fill
                  loading="lazy"
                  sizes="(max-width: 1024px) 90vw, 500px"
                  placeholder="blur"
                  blurDataURL={images.after.blurDataURL}
                  className="object-cover"
                />
              </div>

              {/* Divider handle */}
              <div
                aria-hidden
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-base-100 transition-[left] duration-150 ease-out"
                style={{ left: `${pos}%` }}
              >
                <span className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-base-100 text-primary shadow-glow">
                  ↔
                </span>
              </div>

              {/* Labels */}
              <span className="absolute left-3 top-3 rounded-badge bg-base-100/80 px-2.5 py-1 text-xs font-semibold text-base-content">
                Before
              </span>
              <span className="absolute right-3 top-3 rounded-badge bg-base-100/80 px-2.5 py-1 text-xs font-semibold text-base-content">
                After
              </span>
            </div>

            <label className="mt-4 block">
              <span className="sr-only">Reveal the after photo</span>
              <input
                type="range"
                min={0}
                max={100}
                value={pos}
                onChange={(e) => setPos(Number(e.target.value))}
                className="range range-primary min-h-[44px] w-full"
                aria-label="Before and after comparison slider"
              />
            </label>
            <p className="mt-2 text-sm text-base-content/50">
              Illustrative example
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PetCardShowcase;
