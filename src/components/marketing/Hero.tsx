'use client';
import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { heroLine, staggerParent, micro, useReducedMotion } from '@/lib/animation';
import { Tilt } from '@/components/motion';
import { landing } from '@/content/landing';
import { heroMedia } from './heroMedia';

/**
 * Hero (Section 7.1).
 *
 * Layout:
 *   - Left: eyebrow, headline (font-display), sub, two CTAs, trust line.
 *     Framer owns the line reveal (heroLine + staggerParent) and the CTA
 *     micro-interaction. GSAP is NOT attached to any of these nodes.
 *   - Right: a floating product-mockup card (dashboard + route card) wrapped in
 *     <Tilt>, with the lazy R3F <HeroObject> behind it as pure decoration.
 *
 * Background: `bg-hero` gradient is ALWAYS present (layer 0) so the hero is
 * never empty. An optional poster (heroMedia.poster) paints as the LCP image
 * via next/image priority when present; today poster is null so the gradient
 * shows. Height is reserved (min-h-[92vh]) for CLS 0.
 *
 * Reduced motion / weak devices / Save-Data: no R3F, no tilt movement, and all
 * content is visible immediately (Framer variants resolve to final state
 * because MotionProvider never adds the hide class under reduced motion).
 */

// The single lazy R3F element. ssr:false + lazy import keeps three.js out of
// the server bundle and off the critical path (Section 6.1).
const HeroObject = dynamic(() => import('./HeroObject').then((m) => m.HeroObject), {
  ssr: false,
  loading: () => null,
});

/** Client-only gate for the R3F decoration (Section 6.1). */
function useAllow3D(reduced: boolean): boolean {
  const [allow, setAllow] = React.useState(false);
  React.useEffect(() => {
    if (reduced) {
      setAllow(false);
      return;
    }
    if (typeof window === 'undefined') return;
    const cores = navigator.hardwareConcurrency;
    const lowCore = typeof cores === 'number' && cores <= 4;
    const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
    const saveData = Boolean(conn?.saveData);
    setAllow(!lowCore && !saveData);
  }, [reduced]);
  return allow;
}

export function Hero() {
  const reduced = useReducedMotion();
  const allow3D = useAllow3D(reduced);
  const { hero } = landing;

  return (
    <section
      id="hero"
      className="relative isolate flex min-h-[92vh] items-center overflow-hidden"
    >
      {/* Layer 0: brand gradient — always present, guarantees a non-empty hero. */}
      <div aria-hidden className="absolute inset-0 -z-30 bg-hero" />

      {/* Layer 1: optional poster (LCP image). Null today -> gradient shows. */}
      {heroMedia.poster && (
        <Image
          src={heroMedia.poster}
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-20 object-cover opacity-30"
        />
      )}

      {/* Soft readability wash so foreground text stays legible on the gradient. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-base-100/10 to-base-100/40"
      />

      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-gutter py-24 lg:grid-cols-2">
        {/* ---- Left: copy + CTAs (Framer owns these reveals) ---- */}
        <motion.div
          className="text-center lg:text-left"
          variants={staggerParent(0.12)}
          initial="hidden"
          animate="show"
        >
          <motion.p
            variants={heroLine}
            className="mb-4 text-sm font-semibold uppercase tracking-[0.28em] text-primary"
          >
            {hero.eyebrow}
          </motion.p>

          {/* Headline: reveal per line by clipping the vertical translate. */}
          <h1 className="font-display text-hero font-bold text-base-content">
            <span className="block overflow-hidden pb-1">
              <motion.span variants={heroLine} className="block">
                {hero.headline}
              </motion.span>
            </span>
          </h1>

          <motion.p
            variants={heroLine}
            className="mx-auto mt-6 max-w-xl text-lg text-base-content/70 lg:mx-0"
          >
            {hero.sub}
          </motion.p>

          <motion.div
            variants={heroLine}
            className="mt-10 flex flex-col items-center gap-4 sm:flex-row lg:justify-start"
          >
            <motion.div whileHover={reduced ? undefined : micro.hover} whileTap={micro.tap}>
              <Link
                href={hero.primaryCta.href}
                className="btn btn-primary min-h-[44px] px-8 shadow-glow"
              >
                {hero.primaryCta.label}
              </Link>
            </motion.div>

            <Link
              href={hero.secondaryCta.href}
              className="btn btn-ghost min-h-[44px] px-6 text-base-content"
            >
              {hero.secondaryCta.label}
            </Link>
          </motion.div>

          <motion.p variants={heroLine} className="mt-6 text-sm text-base-content/60">
            {hero.trust}
          </motion.p>
        </motion.div>

        {/* ---- Right: floating product mockup + R3F decoration ---- */}
        <div className="relative mx-auto w-full max-w-md">
          {/* R3F decoration behind the mockup (gated + lazy). */}
          {allow3D && <HeroObject />}

          <Tilt className="relative z-10" max={reduced ? 0 : 10}>
            <ProductMockup />
          </Tilt>
        </div>
      </div>
    </section>
  );
}

/**
 * ProductMockup — a static, theme-tokened mock of the PawPort dashboard with an
 * Order Radar "route card" (Section 7.1). No real data; purely illustrative.
 */
function ProductMockup() {
  return (
    <div className="rounded-box border border-base-content/10 bg-base-100/80 p-4 shadow-card backdrop-blur">
      {/* Fake window chrome */}
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-base-content/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-base-content/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-base-content/20" />
        <span className="ml-3 text-xs font-medium text-base-content/50">Today’s route</span>
      </div>

      {/* Mini schedule rows */}
      <div className="space-y-2">
        {[
          { time: '09:30', label: 'Bella · Full groom' },
          { time: '11:00', label: 'Max · Bath & tidy' },
        ].map((row) => (
          <div
            key={row.time}
            className="flex items-center gap-3 rounded-2xl bg-base-200 px-3 py-2"
          >
            <span className="text-xs font-semibold tabular-nums text-primary">{row.time}</span>
            <span className="truncate text-sm text-base-content/80">{row.label}</span>
          </div>
        ))}
      </div>

      {/* Order Radar route card */}
      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          New booking · Order Radar
        </p>
        <p className="mt-2 text-sm leading-snug text-base-content">
          4.2 km from your 11:00 stop · <span className="font-semibold">+7 min driving</span>
        </p>
        <p className="mt-1 text-sm text-base-content/70">Best fit Thu 2:30</p>

        <div className="mt-3 flex gap-2">
          <span className="btn btn-primary btn-sm min-h-[36px]">Accept</span>
          <span className="btn btn-ghost btn-sm min-h-[36px] text-base-content/70">Decline</span>
        </div>
      </div>
    </div>
  );
}

export default Hero;
