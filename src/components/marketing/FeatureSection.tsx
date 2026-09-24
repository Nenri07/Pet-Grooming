'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import {
  ScrollReveal,
  Parallax,
  fadeUp,
  staggerParent,
} from '@/lib/animation';

type Props = {
  id?: string;
  eyebrow?: string;
  title: string;
  body: string;
  features?: string[];
  /** When true, the visual sits on the left and copy on the right. */
  reversed?: boolean;
};

/**
 * Alternating text/visual feature block. Framer (via ScrollReveal + staggered
 * fadeUp variants) owns the copy reveal. Any parallax targets a DEDICATED
 * image-layer node only (D4) — never the copy column.
 */
export function FeatureSection({
  id,
  eyebrow,
  title,
  body,
  features = [],
  reversed = false,
}: Props) {
  return (
    <section id={id} className="px-gutter py-section">
      <div
        className={`mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2 ${
          reversed ? 'md:[&>*:first-child]:order-2' : ''
        }`}
      >
        {/* Copy column — Framer owns the reveal */}
        <ScrollReveal>
          <motion.div
            variants={staggerParent(0.1)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
          >
            {eyebrow && (
              <motion.p
                variants={fadeUp}
                className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-accent"
              >
                {eyebrow}
              </motion.p>
            )}
            <motion.h2
              variants={fadeUp}
              className="text-h2 font-display font-bold text-base-content"
            >
              {title}
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 text-lg text-base-content/70">
              {body}
            </motion.p>
            {features.length > 0 && (
              <motion.ul variants={fadeUp} className="mt-6 space-y-3">
                {features.map((feat) => (
                  <li key={feat} className="flex items-start gap-3">
                    <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="text-base-content/80">{feat}</span>
                  </li>
                ))}
              </motion.ul>
            )}
          </motion.div>
        </ScrollReveal>

        {/* Visual column — GSAP-owned parallax on a dedicated layer node */}
        <div className="relative">
          <Parallax speed={0.2} className="overflow-hidden rounded-box shadow-soft">
            <div
              aria-hidden
              className="aspect-[4/3] w-full"
              style={{
                background:
                  'radial-gradient(600px 300px at 30% 20%, hsl(var(--color-accent)/0.35), transparent 60%),' +
                  'linear-gradient(140deg, hsl(var(--color-primary)/0.25), hsl(var(--color-secondary)/0.25))',
              }}
            />
          </Parallax>
        </div>
      </div>
    </section>
  );
}
