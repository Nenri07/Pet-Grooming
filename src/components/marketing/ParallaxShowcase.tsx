'use client';
import * as React from 'react';
import { Parallax } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';

/**
 * Layered parallax showcase. Each depth layer is a dedicated node wrapped in
 * the Parallax component, so all scrubbed transforms are owned by GSAP (D4).
 * No Framer transform touches these layer nodes.
 */
export function ParallaxShowcase() {
  return (
    <section className="relative overflow-hidden px-gutter py-section">
      <SectionHeading
        eyebrow="A calmer experience"
        title="Depth, motion, and a little bit of magic"
        subtitle="Every appointment is designed to feel effortless — for you and your pet."
      />

      <div className="relative mx-auto mt-16 h-[420px] max-w-5xl">
        {/* Back layer — moves slowest */}
        <Parallax speed={0.4} className="absolute inset-0">
          <div
            aria-hidden
            className="mx-auto h-72 w-72 rounded-full bg-primary/20 blur-2xl sm:h-96 sm:w-96"
          />
        </Parallax>

        {/* Mid layer */}
        <Parallax speed={0.25} className="absolute inset-0 flex items-center justify-center">
          <div
            aria-hidden
            className="h-56 w-56 rounded-box bg-secondary/25 shadow-glow sm:h-72 sm:w-72"
          />
        </Parallax>

        {/* Front layer — moves fastest */}
        <Parallax speed={0.12} className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-box bg-base-100/80 px-8 py-6 text-center shadow-soft backdrop-blur">
            <p className="text-h2 font-display font-bold text-base-content">Spa-day calm</p>
            <p className="mt-2 text-base-content/70">Right in your driveway</p>
          </div>
        </Parallax>
      </div>
    </section>
  );
}
