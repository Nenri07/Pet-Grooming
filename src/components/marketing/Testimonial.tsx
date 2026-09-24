'use client';
import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Quote } from 'lucide-react';
import { fadeUp, staggerParent } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { landing } from '@/content/landing';

/**
 * Testimonials (Section 7.8) — DATA-DRIVEN from `landing.testimonials`.
 *
 * Section 7.7/7.8 rule: never ship fake quotes. `landing.testimonials` is
 * EMPTY on purpose, so this component renders nothing (returns null) until real
 * quotes exist. When populated it shows a Framer-staggered card grid.
 */
export function Testimonial() {
  const { testimonials } = landing;
  if (testimonials.length === 0) return null;

  return (
    <section aria-labelledby="testimonials-heading" className="bg-base-100 px-gutter py-section">
      <SectionHeading
        eyebrow="Loved by groomers"
        title="What solo groomers say"
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
            key={t.author}
            variants={fadeUp}
            className="reveal-init flex flex-col rounded-box border border-base-content/10 bg-base-200 p-8 shadow-card"
          >
            <Quote className="h-8 w-8 text-accent" aria-hidden="true" />
            <blockquote className="mt-4 flex-1 text-base-content/80">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              {t.avatar && (
                <span className="relative h-10 w-10 overflow-hidden rounded-full">
                  <Image
                    src={t.avatar}
                    alt=""
                    fill
                    loading="lazy"
                    sizes="40px"
                    className="object-cover"
                  />
                </span>
              )}
              <span>
                <p className="font-semibold text-base-content">{t.author}</p>
                {t.role && (
                  <p className="text-sm text-base-content/60">{t.role}</p>
                )}
              </span>
            </figcaption>
          </motion.figure>
        ))}
      </motion.div>
    </section>
  );
}

export default Testimonial;
