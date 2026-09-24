'use client';
import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Reveal } from '@/components/motion';
import { micro, useReducedMotion } from '@/lib/animation';
import { landing } from '@/content/landing';

/**
 * FinalCTA (Section 7.12) — the closing CTA band. Both CTAs are 44px+; the
 * primary drives to /register. The footer itself lives in the (public) layout,
 * so this is just the closing band above it.
 *
 * The band sits on the `bg-hero` gradient with a token overlay so headline
 * contrast stays strong in both themes. Framer owns the reveal + CTA micro.
 */
export function FinalCTA() {
  const reduced = useReducedMotion();
  const { finalCta } = landing;

  return (
    <section aria-labelledby="final-cta-heading" className="relative isolate overflow-hidden bg-base-100">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <div className="relative overflow-hidden rounded-box bg-hero p-10 text-center shadow-card sm:p-16">
          {/* Token overlay for contrast on the gradient. */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-b from-base-100/40 to-base-100/60"
          />

          <Reveal>
            <h2
              id="final-cta-heading"
              className="mx-auto max-w-2xl font-display text-h2 font-bold text-base-content"
            >
              {finalCta.title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-base-content/70">
              {finalCta.sub}
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <motion.div whileHover={reduced ? undefined : micro.hover} whileTap={micro.tap}>
                <Link
                  href={finalCta.primaryCta.href}
                  className="btn btn-primary min-h-[44px] px-8 shadow-glow"
                >
                  {finalCta.primaryCta.label}
                </Link>
              </motion.div>
              <Link
                href={finalCta.secondaryCta.href}
                className="btn btn-ghost min-h-[44px] px-6 text-base-content"
              >
                {finalCta.secondaryCta.label}
              </Link>
            </div>

            <p className="mt-6 text-sm text-base-content/60">{finalCta.trust}</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default FinalCTA;
