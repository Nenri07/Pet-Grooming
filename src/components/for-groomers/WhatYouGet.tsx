'use client';
import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  Globe,
  CalendarCheck,
  Route,
  IdCard,
  MessageSquare,
  Receipt,
  MapPin,
  type LucideIcon,
} from 'lucide-react';
import { staggerParent, fadeUp, reducedVariants, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from '@/components/marketing/SectionHeading';
import { forGroomers, type BundleIcon, type BundleItem } from '@/content/for-groomers';
import { images } from '@/content/images.generated';

/**
 * WhatYouGet — an animated bento grid of the bundle items (adapted from the
 * landing BentoFeatures pattern to the bundle content).
 *
 * Framer owns a staggered in-view reveal on the cells (reveal-init keeps them
 * visible with JS off / under reduced motion). The hover glow is CSS-only
 * (shadow-glow + a bg-primary/5 wash), so it costs nothing on mobile. Cells
 * that carry an image render it lazily with a reserved aspect ratio (CLS 0).
 */

const ICONS: Record<BundleIcon, LucideIcon> = {
  globe: Globe,
  'calendar-check': CalendarCheck,
  route: Route,
  'id-card': IdCard,
  'message-square': MessageSquare,
  receipt: Receipt,
  'map-pin': MapPin,
};

function cellClasses(size: BundleItem['size']): string {
  return size === 'wide' ? 'sm:col-span-2' : '';
}

export function WhatYouGet() {
  const reduced = useReducedMotion();
  const item = reduced ? reducedVariants : fadeUp;
  const { whatYouGet } = forGroomers;

  return (
    <section id="whats-included" aria-labelledby="whats-included-heading" className="bg-base-100">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          eyebrow={whatYouGet.eyebrow}
          title={whatYouGet.title}
          subtitle={whatYouGet.subtitle}
          titleId="whats-included-heading"
        />

        <motion.ul
          className="mt-14 grid auto-rows-[minmax(11rem,auto)] grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerParent(0.09)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
        >
          {whatYouGet.items.map((f) => {
            const Icon = ICONS[f.icon];
            const img = f.image ? images[f.image] : null;

            return (
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
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-bold text-base-content">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm text-base-content/70">{f.description}</p>
                </div>

                {img && (
                  <div className="relative mt-5 aspect-[16/9] w-full overflow-hidden rounded-2xl border border-base-content/10">
                    <Image
                      src={img.src}
                      alt={img.alt}
                      fill
                      loading="lazy"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 66vw, 33vw"
                      placeholder="blur"
                      blurDataURL={img.blurDataURL}
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                )}
              </motion.li>
            );
          })}
        </motion.ul>
      </div>
    </section>
  );
}

export default WhatYouGet;
