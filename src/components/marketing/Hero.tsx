import * as React from 'react';
import Link from 'next/link';
import { landing } from '@/content/landing';
import { HeroVisual } from './HeroVisual';

/**
 * Hero (Section 7.1): the single <h1>.
 *
 * All copy and links come from `landing.hero` (the single source of truth, and
 * covered by tests/plan-copy.test.ts). Do not hardcode stats, ratings or
 * numbers here: proof stays empty until it is real (see landing.ts, 7.7).
 */
export function Hero() {
  const { eyebrow, headline, sub, primaryCta, secondaryCta, trust } = landing.hero;

  // "Groom more dogs. Drive less." -> two-tone headline; falls back to plain text.
  const split = headline.indexOf('. ');
  const first = split > 0 ? headline.slice(0, split + 1) : headline;
  const second = split > 0 ? headline.slice(split + 2) : '';

  return (
    <section id="hero" className="border-b border-base-300 bg-base-100 pb-14 pt-28 md:pb-20 md:pt-36">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-10 xl:gap-16">
          <div className="lg:col-span-5">
            {/* Same eyebrow style as every other section heading. */}
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.3em] text-accent">{eyebrow}</p>

            <h1 className="mb-6 max-w-[20ch] font-display text-hero font-semibold text-base-content">
              {first}
              {second && (
                <>
                  <br />
                  <span className="text-base-content/60">{second}</span>
                </>
              )}
            </h1>

            <p className="mb-8 max-w-[55ch] text-lg leading-relaxed text-base-content/70 md:text-xl">{sub}</p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={primaryCta.href}
                className="btn btn-primary h-auto min-h-[44px] rounded-full border-0 px-6 py-3 text-base font-medium"
              >
                {primaryCta.label}
              </Link>
              <Link
                href={secondaryCta.href}
                className="btn btn-ghost h-auto min-h-[44px] rounded-full border border-base-300 bg-base-100 px-6 py-3 text-base font-medium"
              >
                {secondaryCta.label}
              </Link>
            </div>

            <p className="mt-6 text-sm text-base-content/60">{trust}</p>
          </div>

          <div className="lg:col-span-7">
            <HeroVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;
