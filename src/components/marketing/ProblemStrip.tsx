'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import { staggerParent, fadeUp, reducedVariants, useReducedMotion } from '@/lib/animation';
import { landing } from '@/content/landing';

/**
 * ProblemStrip (Section 7.2) — three pain-point cards that each map to a
 * solution further down the page.
 *
 * Framer owns a staggered reveal on the cards. Each card carries `reveal-init`
 * so the "visible by default" CSS keeps them readable with JS off / under
 * reduced motion; the stagger only plays when JS is live and motion is allowed.
 */
export function ProblemStrip() {
  const reduced = useReducedMotion();
  const item = reduced ? reducedVariants : fadeUp;

  return (
    <section aria-labelledby="problem-heading" className="bg-base-100">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <h2 id="problem-heading" className="sr-only">
          The daily grind of a solo mobile groomer
        </h2>

        <motion.ul
          className="grid gap-6 md:grid-cols-3"
          variants={staggerParent(0.12)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
        >
          {landing.problems.map((p) => (
            <motion.li
              key={p.title}
              variants={item}
              className="reveal-init rounded-box border border-base-content/10 bg-base-200 p-8 shadow-card"
            >
              <p className="font-display text-xl font-bold text-base-content">
                {p.title}
              </p>
              <p className="mt-3 text-base text-base-content/70">{p.body}</p>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

export default ProblemStrip;
