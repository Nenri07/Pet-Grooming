'use client';
import * as React from 'react';
import { motion, useInView } from 'framer-motion';
import { fadeUp, reducedVariants } from './variants';
import { useReducedMotion } from './useReducedMotion';

type Props = React.PropsWithChildren<{
  className?: string;
  /** Fraction of element visible before triggering (default 0.2). */
  amount?: number;
  /** Delay in seconds for staggered manual sequencing. */
  delay?: number;
  as?: keyof typeof motion;
}>;

/**
 * In-view reveal. Framer OWNS opacity+y here (D4). Do not attach a GSAP
 * ScrollTrigger that animates opacity/transform to the same node.
 */
export function ScrollReveal({ children, className, amount = 0.2, delay = 0 }: Props) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount, once: true });
  const reduced = useReducedMotion();
  const variants = reduced ? reducedVariants : fadeUp;

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={variants}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}
