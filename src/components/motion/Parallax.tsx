'use client';

/**
 * Parallax — re-export of the GSAP-owned parallax layer in `@/lib/animation`.
 *
 * GSAP owns the `yPercent` transform on a dedicated wrapper layer; it is never
 * combined with a Framer transform on the same node, and it renders static
 * under reduced motion. Re-exported here so all motion primitives live behind
 * the single `@/components/motion` barrel.
 */
export { Parallax } from '@/lib/animation';
export { Parallax as default } from '@/lib/animation';
