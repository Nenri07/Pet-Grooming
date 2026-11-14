'use client';

import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  BarChart3,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Calculator,
  Images,
  Mail,
  MapPin,
  PawPrint,
  Repeat,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { staggerParent, fadeUp, reducedVariants, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { ProPill } from './ProPill';
import { landing, type FeatureIcon } from '@/content/landing';
import { images } from '@/content/images.generated';

/**
 * BentoFeatures (Section 7.4): a grid of feature cells.
 *
 * Layout rule: the content list is one `wide` cell plus normal cells, so the
 * grid fills evenly at 2 and 3 columns with no empty slot. Do not add `tall`
 * cells; they leave holes in an auto-placed grid.
 *
 * Framer owns a staggered in-view reveal on the cells (reveal-init keeps them
 * visible by default). The one image is lazy with a reserved aspect ratio.
 */

const ICONS: Record<FeatureIcon, LucideIcon> = {
  booking: CalendarCheck,
  deposit: Wallet,
  estimate: Calculator,
  area: MapPin,
  availability: CalendarClock,
  messaging: Mail,
  calendar: CalendarDays,
  petcard: PawPrint,
  rebook: Repeat,
  beforeafter: Images,
  analytics: BarChart3,
};

export function BentoFeatures() {
  const reduced = useReducedMotion();
  const item = reduced ? reducedVariants : fadeUp;

  return (
    <section id="features" aria-labelledby="features-heading" className="bg-base-200 py-band">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeading
          eyebrow="Everything in one place"
          title="Run your whole day from one app"
          subtitle="Booking, payments, messaging and route smarts — built for a solo van, not a salon."
          titleId="features-heading"
        />

        <motion.ul
          className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerParent(0.06)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
        >
          {landing.features.map((f) => {
            const Icon = f.icon ? ICONS[f.icon] : null;
            const wide = f.size === 'wide';
            return (
              <motion.li
                key={f.title}
                variants={item}
                className={[
                  'reveal-init flex flex-col gap-5 rounded-xl border border-base-300 bg-base-100 p-6 transition-colors duration-200 hover:border-primary/40',
                  wide ? 'sm:col-span-2 sm:flex-row sm:items-center' : '',
                ].join(' ')}
              >
                <div className={wide ? 'sm:flex-1' : ''}>
                  {Icon && (
                    <span
                      aria-hidden
                      className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-base-300 bg-base-200 text-primary"
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </span>
                  )}
                  <h3 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-base-content">
                    {f.title}
                    {f.pro && <ProPill />}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-base-content/70">{f.body}</p>
                </div>

                {f.withImage && (
                  <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-lg border border-base-300 sm:w-[46%]">
                    <Image
                      src={images.featureBooking.src}
                      alt={images.featureBooking.alt}
                      fill
                      loading="lazy"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 30vw"
                      placeholder="blur"
                      blurDataURL={images.featureBooking.blurDataURL}
                      className="object-cover"
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
