'use client';
import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { staggerParent, fadeUp, reducedVariants, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { landing, type Feature } from '@/content/landing';
import { images } from '@/content/images.generated';

/**
 * BentoFeatures (Section 7.4) — a bento grid of six features with varied cell
 * sizes and a spotlight/hover glow.
 *
 * The hover glow is CSS-only (shadow-glow + a bg-primary/5 wash that fades in
 * on hover), so it costs nothing on mobile and needs no JS. Framer owns a
 * staggered in-view reveal on the cells (reveal-init keeps them visible by
 * default). One cell renders `images.featureBooking` where a visual helps; that
 * image is lazy (no priority) with a reserved aspect ratio for CLS 0.
 */

function cellClasses(size: Feature['size']): string {
  switch (size) {
    case 'wide':
      return 'sm:col-span-2';
    case 'tall':
      return 'sm:row-span-2';
    default:
      return '';
  }
}

export function BentoFeatures() {
  const reduced = useReducedMotion();
  const item = reduced ? reducedVariants : fadeUp;

  return (
    <section id="features" aria-labelledby="features-heading" className="bg-base-100">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          eyebrow="Everything in one place"
          title="Run your whole day from one app"
          subtitle="Booking, payments, messaging and route smarts — built for a solo van, not a salon."
        />

        <motion.ul
          className="mt-14 grid auto-rows-[minmax(11rem,auto)] grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerParent(0.09)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
        >
          {landing.features.map((f) => (
            <motion.li
              key={f.title}
              variants={item}
              className={[
                'group reveal-init relative flex flex-col justify-between overflow-hidden rounded-box border border-base-content/10 bg-base-200 p-6 shadow-card transition-shadow duration-300 hover:shadow-glow',
                cellClasses(f.size),
              ].join(' ')}
            >
              {/* Hover spotlight wash (token-only, decorative). */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-primary/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />

              <div className="relative">
                <h3 className="font-display text-lg font-bold text-base-content">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-base-content/70">{f.body}</p>
              </div>

              {f.withImage && (
                <div className="relative mt-5 aspect-[16/9] w-full overflow-hidden rounded-2xl border border-base-content/10">
                  <Image
                    src={images.featureBooking.src}
                    alt={images.featureBooking.alt}
                    fill
                    loading="lazy"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 66vw, 33vw"
                    placeholder="blur"
                    blurDataURL={images.featureBooking.blurDataURL}
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
              )}
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

export default BentoFeatures;
