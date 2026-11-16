'use client';

import * as React from 'react';
import { motion, type Variants } from 'framer-motion';
import { reducedVariants, useReducedMotion } from '@/lib/animation';

/**
 * HeroVisual: the product composition on the right of the hero (the dashboard
 * on a laptop with a dog peeking over it, and the booking page on a phone with
 * a cat on top).
 *
 * The artwork ships as two transparent layers cut from `pawxis-hero-pets.png`
 * at the phone's right edge (scripts/split-hero.py rebuilds them). Stacked, they reproduce the original image exactly; split,
 * the phone can enter ~150ms after the window.
 *
 * Each layer is a <picture>: WebP for browsers that support it, PNG fallback.
 * (next/image can't express a format fallback, hence a plain <img>.)
 * Both layers share the source's 1600x1200 canvas, so `object-contain` keeps
 * them aligned at every size and the box reserves space up front (no CLS).
 */

const ease: [number, number, number, number] = [0.16, 1, 0.3, 1];

const layer = (delay: number): Variants => ({
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease, delay } },
});

const BASE = '/images/marketing/pawxis-hero';
const W = 1600;
const H = 1200;

function Layer({
  name,
  alt,
  variants,
  priority = false,
}: {
  name: 'window' | 'phone';
  alt: string;
  variants: Variants;
  priority?: boolean;
}) {
  return (
    <motion.picture variants={variants} className="absolute inset-0 block">
      <source type="image/webp" srcSet={`${BASE}-${name}.webp`} />
      {/* eslint-disable-next-line @next/next/no-img-element -- needs a <picture> WebP/PNG fallback */}
      <img
        src={`${BASE}-${name}.png`}
        alt={alt}
        width={W}
        height={H}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        draggable={false}
        className="h-full w-full select-none object-contain"
      />
    </motion.picture>
  );
}

export function HeroVisual() {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="relative mx-auto aspect-[4/3] w-full max-w-2xl lg:max-w-none"
      initial="hidden"
      animate="show"
    >
      <Layer
        name="window"
        priority
        alt="The Pawxis dashboard with today's route and Order Radar on a laptop, with a dog peeking over the top, next to the client booking page on a phone with a cat on top"
        variants={reduced ? reducedVariants : layer(0)}
      />
      {/* Same artwork, described by the layer above. */}
      <Layer name="phone" priority alt="" variants={reduced ? reducedVariants : layer(0.15)} />
    </motion.div>
  );
}

export default HeroVisual;
