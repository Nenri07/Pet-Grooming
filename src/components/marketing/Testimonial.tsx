'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import { Quote } from 'lucide-react';
import { fadeUp, staggerParent } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';

type Item = { quote: string; name: string; role: string };

const testimonials: Item[] = [
  {
    quote:
      'Booking took under a minute and the groomer arrived right on time. My anxious rescue actually stayed calm the whole visit.',
    name: 'Maya R.',
    role: 'Owner of Biscuit, Cavapoo',
  },
  {
    quote:
      'No more crate rides across town. PawPort comes to us, and the results look better than any salon we tried.',
    name: 'Daniel K.',
    role: 'Owner of Miso, Shiba Inu',
  },
  {
    quote:
      'As a groomer, the scheduling and client tools are effortless. I spend my time with pets, not paperwork.',
    name: 'Priya S.',
    role: 'Mobile groomer, 6 years',
  },
];

/**
 * Testimonial cards. Framer owns the in-view reveal and quote stagger.
 * No GSAP is used here (D4).
 */
export function Testimonial() {
  return (
    <section className="px-gutter py-section">
      <SectionHeading
        eyebrow="Loved by pets & people"
        title="Real visits, real tails wagging"
      />

      <motion.div
        className="mx-auto mt-16 grid max-w-6xl gap-6 md:grid-cols-3"
        variants={staggerParent(0.12)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
      >
        {testimonials.map((t) => (
          <motion.figure
            key={t.name}
            variants={fadeUp}
            className="flex flex-col rounded-box bg-base-100 p-8 shadow-card"
          >
            <Quote className="h-8 w-8 text-accent" aria-hidden="true" />
            <blockquote className="mt-4 flex-1 text-base-content/80">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-6">
              <p className="font-semibold text-base-content">{t.name}</p>
              <p className="text-sm text-base-content/60">{t.role}</p>
            </figcaption>
          </motion.figure>
        ))}
      </motion.div>
    </section>
  );
}
