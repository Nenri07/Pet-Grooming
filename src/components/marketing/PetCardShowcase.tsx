'use client';
import * as React from 'react';
import Image from 'next/image';
import { Tilt } from '@/components/motion';
import { useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { images } from '@/content/images.generated';

/**
 * PetCardShowcase (Section 7.6) — a 3D-tilt sample Digital Pet Card next to a
 * Before/After slider.
 *
 * The slider is a simple range input that clips the "after" image via a
 * clip-path. Under reduced motion the range still works on demand but starts at
 * a static 50/50 split and the tilt is disabled (Tilt handles that internally).
 * A "Illustrative example" caption makes clear these are not a real customer.
 */

export function PetCardShowcase() {
  const reduced = useReducedMotion();
  const [pos, setPos] = React.useState(50);

  return (
    <section aria-labelledby="petcard-heading" className="bg-base-100">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          eyebrow="Looks like a big brand"
          title="Digital Pet Cards clients love to share"
          subtitle="Every pet gets a card with their profile and a before/after that owners want to show off."
        />

        <div className="mt-14 grid items-center gap-12 lg:grid-cols-2">
          {/* ---- Sample Digital Pet Card (3D tilt) ---- */}
          <div className="flex justify-center">
            <Tilt className="w-full max-w-sm" max={reduced ? 0 : 12}>
              <div className="rounded-box border border-base-content/10 bg-base-200 p-5 shadow-card">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
                  <Image
                    src={images.featureCard.src}
                    alt={images.featureCard.alt}
                    fill
                    loading="lazy"
                    sizes="(max-width: 1024px) 90vw, 400px"
                    placeholder="blur"
                    blurDataURL={images.featureCard.blurDataURL}
                    className="object-cover"
                  />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <p className="font-display text-lg font-bold text-base-content">
                      Bella
                    </p>
                    <p className="text-sm text-base-content/60">
                      Cockapoo · Curly coat
                    </p>
                  </div>
                  <span className="rounded-badge bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
                    Every 5 weeks
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-base-100 px-3 py-2">
                    <dt className="text-base-content/60">Temperament</dt>
                    <dd className="font-medium text-base-content">Gentle</dd>
                  </div>
                  <div className="rounded-2xl bg-base-100 px-3 py-2">
                    <dt className="text-base-content/60">Last style</dt>
                    <dd className="font-medium text-base-content">Teddy trim</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[0.7rem] text-base-content/50">
                  Illustrative example
                </p>
              </div>
            </Tilt>
          </div>

          {/* ---- Before/After slider ---- */}
          <div>
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
                className="absolute inset-0"
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
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-base-100"
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
            <p className="mt-2 text-sm text-base-content/50">Illustrative example</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PetCardShowcase;
