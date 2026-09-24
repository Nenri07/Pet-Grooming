import type { Variants } from 'framer-motion';

const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: easeOutExpo } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.6, ease: easeOutExpo } },
};

/** Parent that staggers children (feature grids, stat rows). */
export const staggerParent = (stagger = 0.08): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: 0.1 } },
});

/** Hero headline word/line reveal. */
export const heroLine: Variants = {
  hidden: { opacity: 0, y: '40%' },
  show: { opacity: 1, y: '0%', transition: { duration: 0.9, ease: easeOutExpo } },
};

/** Micro-interaction presets for hover/tap (buttons, cards). */
export const micro = {
  hover: { scale: 1.03, transition: { duration: 0.2, ease: easeOutExpo } },
  tap: { scale: 0.97 },
};

/** Reduced-motion variants: same names, no transform, instant. */
export const reducedVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0 } },
};
