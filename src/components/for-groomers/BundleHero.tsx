'use client';
import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { CalendarCheck } from 'lucide-react';
import { heroLine, staggerParent, micro, useReducedMotion } from '@/lib/animation';
import { Tilt } from '@/components/motion';
import { forGroomers } from '@/content/for-groomers';

/**
 * BundleHero — the `/for-groomers` hero.
 *
 * Mirrors the landing Hero's structure and motion ownership: Framer owns the
 * per-line reveal (heroLine + staggerParent) and the CTA micro-interaction; the
 * `bg-hero` gradient is always present as layer 0 so the hero is never empty.
 *
 * The right column is a <Tilt> mock of a groomer's OWN branded site: a mini
 * browser chrome showing "{Business} — Book now" with a booking card. Purely
 * illustrative, theme-tokens only. Under reduced motion Tilt renders flat and
 * all copy is visible immediately.
 */
export function BundleHero() {
  const reduced = useReducedMotion();
  const { hero } = forGroomers;

  return (
    <section
      id="hero"
      aria-labelledby="for-groomers-hero-heading"
      className="relative isolate flex min-h-[88vh] items-center overflow-hidden"
    >
      {/* Layer 0: brand gradient — always present. */}
      <div aria-hidden className="absolute inset-0 -z-30 bg-hero" />
      {/* Token readability wash so the headline keeps contrast in both themes. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-base-100/80 via-base-100/60 to-base-100/85"
      />

      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-gutter py-24 lg:grid-cols-2">
        {/* ---- Left: copy + CTAs ---- */}
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

          <h1
            id="for-groomers-hero-heading"
            className="font-display text-hero font-bold text-base-content"
          >
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

        {/* ---- Right: branded-site mock in a Tilt ---- */}
        <div className="relative mx-auto w-full max-w-md">
          <Tilt className="relative z-10" max={reduced ? 0 : 10}>
            <BrandedSiteMock business={hero.mockBusiness} />
          </Tilt>
        </div>
      </div>
    </section>
  );
}

/**
 * BrandedSiteMock — a static, theme-tokened mock of a groomer's own branded
 * booking site inside a mini browser chrome. No real data; illustrative only.
 */
function BrandedSiteMock({ business }: { business: string }) {
  const slug = business.toLowerCase().replace(/[^a-z0-9]+/g, '');

  return (
    <div className="rounded-box border border-base-content/10 bg-base-100/80 shadow-card backdrop-blur">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-base-content/10 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-base-content/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-base-content/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-base-content/20" />
        <span className="ml-3 truncate rounded-full bg-base-200 px-3 py-1 text-xs font-medium text-base-content/50">
          {slug}.pawport.app
        </span>
      </div>

      {/* Site body */}
      <div className="p-5">
        {/* Branded header row */}
        <div className="flex items-center justify-between">
          <span className="font-display text-lg font-bold text-primary">{business}</span>
          <span className="btn btn-primary btn-sm min-h-[36px]">Book now</span>
        </div>

        {/* Hero-ish strip */}
        <div className="mt-4 rounded-2xl bg-hero p-4">
          <p className="font-display text-base font-semibold text-base-content">
            Mobile grooming that comes to you
          </p>
          <p className="mt-1 text-xs text-base-content/70">Fresh coats, no trip to the salon.</p>
        </div>

        {/* Booking card */}
        <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Book a groom
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {[
              { time: 'Thu 2:30 PM', label: 'Full groom · Bella' },
              { time: 'Fri 10:00 AM', label: 'Bath & tidy · Max' },
            ].map((row) => (
              <div
                key={row.time}
                className="flex items-center gap-3 rounded-xl bg-base-100 px-3 py-2"
              >
                <span className="text-xs font-semibold tabular-nums text-primary">{row.time}</span>
                <span className="truncate text-sm text-base-content/80">{row.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-base-content/60">$15 deposit</span>
            <span className="btn btn-primary btn-sm min-h-[36px]">Confirm</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BundleHero;
