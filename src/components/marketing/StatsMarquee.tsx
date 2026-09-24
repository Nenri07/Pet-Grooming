'use client';
import * as React from 'react';
import { Marquee, NumberTicker } from '@/components/motion';
import { landing } from '@/content/landing';

/**
 * StatsMarquee (Section 7.7) — a services marquee plus a proof row.
 *
 * Proof rules (Section 7.7): `landing.stats` is EMPTY on purpose, so we DO NOT
 * invent numbers. While empty, we show the founding-groomer program line. If
 * real stats are added later, each renders via NumberTicker (which is SSR-safe:
 * the final number is in the server HTML and only counts up after hydration).
 *
 * The services marquee is owned by the GSAP `Marquee` primitive (infinite
 * x-loop, static under reduced motion). It is decorative, so it is aria-hidden.
 */
export function StatsMarquee() {
  const { stats, founding, services } = landing;
  const hasStats = stats.length > 0;

  return (
    <section aria-labelledby="proof-heading" className="bg-base-200 py-section">
      <h2 id="proof-heading" className="sr-only">
        Services and proof
      </h2>

      {/* Proof row: real stats if present, otherwise founding-program line. */}
      <div className="mx-auto max-w-5xl px-gutter">
        {hasStats ? (
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-h2 font-display font-bold text-primary">
                  <NumberTicker
                    value={s.value}
                    prefix={s.prefix}
                    suffix={s.suffix}
                  />
                </div>
                <p className="mt-2 text-sm text-base-content/70">{s.label}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl rounded-box border border-primary/20 bg-primary/5 px-6 py-8 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-accent">
              Founding groomer program
            </p>
            <p className="mt-3 font-display text-h2 font-bold text-base-content">
              {founding.spots} spots
            </p>
            <p className="mt-2 text-base text-base-content/70">
              Join the first {founding.spots} groomers and lock in founding
              pricing for life.
            </p>
          </div>
        )}
      </div>

      {/* Services marquee — GSAP-owned, decorative. */}
      <div aria-hidden className="mt-16">
        <Marquee speed={26}>
          {services.map((word) => (
            <span
              key={word}
              className="text-h2 font-display font-semibold text-base-content/15"
            >
              {word}
              <span className="mx-8 text-accent">&bull;</span>
            </span>
          ))}
        </Marquee>
      </div>
    </section>
  );
}

export default StatsMarquee;
