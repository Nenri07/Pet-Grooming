'use client';
import * as React from 'react';
import {
  motion,
  useInView,
  useMotionValue,
  animate,
  useTransform,
} from 'framer-motion';
import { useGsapContext, useReducedMotion } from '@/lib/animation';

type Stat = { value: number; suffix?: string; label: string };

const stats: Stat[] = [
  { value: 12000, suffix: '+', label: 'Happy pets groomed' },
  { value: 98, suffix: '%', label: 'Owner satisfaction' },
  { value: 40, suffix: '+', label: 'Cities served' },
  { value: 15, suffix: 'min', label: 'Average booking time' },
];

const marqueeWords = [
  'Nail trims',
  'Full grooms',
  'De-shedding',
  'Bath & brush',
  'Puppy first cut',
  'Senior care',
];

/**
 * Framer owns the in-view number count-up. GSAP owns the infinite marquee
 * x-loop (via useGsapContext). Under reduced motion the count-up shows the
 * final value instantly and the marquee stays static.
 */
function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v).toLocaleString());

  React.useEffect(() => {
    if (!inView) return;
    if (reduced) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [inView, reduced, value, count]);

  return (
    <span ref={ref} className="tabular-nums">
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}

export function StatsMarquee() {
  const reduced = useReducedMotion();

  const marqueeScope = useGsapContext(
    ({ gsap, reduced: r, scope }) => {
      if (r) return; // static under reduced motion
      const track = scope.querySelector('[data-marquee-track]');
      if (!track) return;
      // Loop the first half; the track renders two copies for a seamless wrap.
      gsap.to(track, {
        xPercent: -50,
        ease: 'none',
        duration: 22,
        repeat: -1,
      });
    },
    [],
  );

  return (
    <section className="bg-base-200 py-section">
      {/* Stats grid — Framer count-up */}
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-gutter md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-h2 font-display font-bold text-primary">
              <CountUp value={s.value} suffix={s.suffix} />
            </div>
            <p className="mt-2 text-sm text-base-content/70">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Marquee — GSAP-owned infinite x-loop */}
      <div
        ref={marqueeScope as React.RefObject<HTMLDivElement>}
        className="mt-16 overflow-hidden"
        aria-hidden
      >
        <div
          data-marquee-track
          className={`flex w-max gap-8 whitespace-nowrap ${
            reduced ? '' : 'will-change-transform'
          }`}
        >
          {[...marqueeWords, ...marqueeWords].map((word, i) => (
            <span
              key={`${word}-${i}`}
              className="text-h2 font-display font-semibold text-base-content/15"
            >
              {word}
              <span className="mx-8 text-accent">&bull;</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
