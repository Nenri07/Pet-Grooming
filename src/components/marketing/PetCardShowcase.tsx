'use client';
import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Tilt } from '@/components/motion';
import { useGsapContext, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { images } from '@/content/images.generated';

/**
 * PetCardShowcase (Section 7.6) — a flippable sample Digital Pet Card next to a
 * Before/After slider.
 *
 * Motion ownership (kept strictly separated so no two owners fight):
 *   - Tilt (Framer, OUTER node) owns the subtle pointer-follow rotateX/rotateY
 *     parallax on the whole card.
 *   - The flip (Framer, INNER node) owns rotateY 0↔180 with preserve-3d +
 *     backface-hidden. Because the flip lives on a different node than Tilt,
 *     the two transforms compose instead of overwriting each other.
 *   - A dedicated decorative layer behind the before/after image gets a GSAP
 *     parallax float; it is a separate node from the image the slider clips.
 *
 * Reduced motion: Tilt renders flat (handled internally), the flip does not
 * animate (a button toggles front/back instantly), and the decorative layer is
 * static. The range slider still works on demand.
 *
 * "Illustrative example" captions make clear these are not a real customer.
 */

export function PetCardShowcase() {
  const reduced = useReducedMotion();
  const [pos, setPos] = React.useState(50);
  const [flipped, setFlipped] = React.useState(false);

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
          title="Digital Pet Cards clients love to share"
          subtitle="Every pet gets a card with their profile and a before/after that owners want to show off."
        />

        <div
          ref={decoRef as React.RefObject<HTMLDivElement>}
          className="relative mt-14 grid items-center gap-12 lg:grid-cols-2"
        >
          {/* ---- Sample Digital Pet Card (Tilt outside, flip inside) ---- */}
          <div className="flex flex-col items-center">
            <Tilt className="w-full max-w-sm" max={reduced ? 0 : 10}>
              <div
                className="group relative cursor-pointer [perspective:1200px]"
                onClick={() => setFlipped((f) => !f)}
                onMouseEnter={() => !reduced && setFlipped(true)}
                onMouseLeave={() => !reduced && setFlipped(false)}
                role="button"
                tabIndex={0}
                aria-pressed={flipped}
                aria-label="Flip the sample Digital Pet Card"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setFlipped((f) => !f);
                  }
                }}
              >
                <motion.div
                  className="relative [transform-style:preserve-3d]"
                  animate={reduced ? undefined : { rotateY: flipped ? 180 : 0 }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* ---- FRONT ---- */}
                  <div
                    className={
                      'rounded-box border border-base-content/10 bg-base-200 p-5 shadow-card [backface-visibility:hidden] ' +
                      (reduced && flipped ? 'hidden' : '')
                    }
                  >
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
                        <dd className="font-medium text-base-content">
                          Teddy trim
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-[0.7rem] text-base-content/50">
                      {reduced ? 'Tap to flip · ' : 'Hover or tap to flip · '}
                      Illustrative example
                    </p>
                  </div>

                  {/* ---- BACK ---- */}
                  <div
                    className={
                      'rounded-box border border-primary/20 bg-base-200 p-5 shadow-card [backface-visibility:hidden] [transform:rotateY(180deg)] ' +
                      (reduced
                        ? flipped
                          ? 'relative [transform:none]'
                          : 'hidden'
                        : 'absolute inset-0')
                    }
                  >
                    <p className="font-display text-lg font-bold text-base-content">
                      Bella&apos;s history
                    </p>
                    <ul className="mt-3 space-y-2 text-sm">
                      {[
                        { date: '12 Jun', style: 'Full groom · Teddy trim' },
                        { date: '08 May', style: 'Bath & tidy' },
                        { date: '03 Apr', style: 'Full groom · De-shed' },
                      ].map((h) => (
                        <li
                          key={h.date}
                          className="flex items-center justify-between rounded-2xl bg-base-100 px-3 py-2"
                        >
                          <span className="font-medium text-base-content">
                            {h.style}
                          </span>
                          <span className="tabular-nums text-base-content/60">
                            {h.date}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-base-content/50">
                          Next visit
                        </p>
                        <p className="font-semibold text-primary">Thu 17 Jul</p>
                      </div>
                      <div
                        aria-hidden
                        className="flex h-12 w-12 items-center justify-center rounded-xl bg-base-100 shadow-soft"
                      >
                        {/* QR-ish share hint (decorative). */}
                        <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
                          {[1, 0, 1, 0, 1, 0, 1, 1, 1].map((on, i) => (
                            <span
                              key={i}
                              className={
                                'h-1.5 w-1.5 rounded-[1px] ' +
                                (on ? 'bg-primary' : 'bg-base-content/10')
                              }
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-[0.7rem] text-base-content/50">
                      Scan to share · Illustrative example
                    </p>
                  </div>
                </motion.div>
              </div>
            </Tilt>
          </div>

          {/* ---- Before/After slider ---- */}
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
