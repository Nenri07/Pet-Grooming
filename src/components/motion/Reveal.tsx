'use client';
import * as React from 'react';
import { motion, useInView, type Variants } from 'framer-motion';
import { reducedVariants, useReducedMotion } from '@/lib/animation';

const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

type Props = React.PropsWithChildren<{
  className?: string;
  /** Fraction of the element visible before triggering (default 0.2). */
  amount?: number;
  /** Delay in seconds before the reveal starts. */
  delay?: number;
  /** Vertical travel distance in px (default 24). Ignored under reduced motion. */
  y?: number;
  /** Reveal only the first time it enters the viewport (default true). */
  once?: boolean;
  /**
   * Reveal duration in seconds (default 0.7 for marketing). The portal passes a
   * shorter value to stay calm/fast (Master Spec §8: ≤300ms).
   */
  duration?: number;
}>;

/**
 * Reveal — Framer Motion in-view reveal wrapper.
 *
 * Framer OWNS opacity + y on this node (never share it with a GSAP transform).
 * Under reduced motion it uses {@link reducedVariants} (instant, full opacity,
 * no transform). The `reveal-init` class lets the "visible by default" CSS
 * (theme.css) keep the element visible when JS is off / during SSR, and only
 * hide it once `html.js-anim` is present.
 */
export function Reveal({
  children,
  className,
  amount = 0.2,
  delay = 0,
  y = 24,
  once = true,
  duration = 0.7,
}: Props) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount, once });
  const reduced = useReducedMotion();

  const variants: Variants = reduced
    ? reducedVariants
    : {
        hidden: { opacity: 0, y },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration, ease: easeOutExpo },
        },
      };

  return (
    <motion.div
      ref={ref}
      className={['reveal-init', className].filter(Boolean).join(' ')}
      variants={variants}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

export default Reveal;
