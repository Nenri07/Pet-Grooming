'use client';
import * as React from 'react';
import { gsap } from 'gsap';
import { useAnimationReady, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { landing } from '@/content/landing';

/**
 * HowItWorks — a 3-step scroll-linked stepper (Book → Route → Receipt).
 *
 * Motion ownership:
 *   - GSAP + ScrollTrigger own a single scroll PROGRESS value (0..1) for the
 *     section. That progress is pushed into React state, and each step derives
 *     its own opacity/translate + the connecting rail's fill from it. GSAP
 *     never animates the same nodes the derived styles touch, so there is no
 *     dual-owner conflict (mirrors OrderRadarShowcase's approach).
 *
 * Reduced motion / JS-off / SSR: `progress` stays at 1, so every step and the
 * full rail render in their final visible state — a plain static list.
 */

/** Progress threshold (0..1) at which each step becomes fully visible. */
const STEP_THRESHOLDS = [0.15, 0.45, 0.75];

function visibility(progress: number, threshold: number, ramp = 0.2) {
  const t = (progress - threshold + ramp) / ramp;
  return Math.max(0, Math.min(1, t));
}

export function HowItWorks() {
  const ready = useAnimationReady();
  const reduced = useReducedMotion();
  const { howItWorks } = landing;
  const scopeRef = React.useRef<HTMLDivElement | null>(null);

  // Final state by default (SSR, JS-off, reduced motion).
  const [progress, setProgress] = React.useState(1);

  React.useLayoutEffect(() => {
    if (!ready || reduced || !scopeRef.current) return;
    const scope = scopeRef.current;

    const ctx = gsap.context(() => {
      setProgress(0);
      gsap.timeline({
        scrollTrigger: {
          trigger: scope,
          start: 'top 75%',
          end: 'bottom 60%',
          scrub: true,
          onUpdate: (self) => setProgress(self.progress),
          onLeaveBack: () => setProgress(0),
        },
      });
    }, scope);

    return () => {
      ctx.revert();
      setProgress(1);
    };
  }, [ready, reduced]);

  // Rail fill tracks overall progress across the three steps.
  const railFill = Math.max(
    0,
    Math.min(1, (progress - STEP_THRESHOLDS[0] + 0.2) / (STEP_THRESHOLDS[2] - STEP_THRESHOLDS[0] + 0.2))
  );

  return (
    <section aria-labelledby="how-heading" className="bg-base-100">
      <div ref={scopeRef} className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          titleId="how-heading"
          eyebrow={howItWorks.eyebrow}
          title={howItWorks.title}
          subtitle={howItWorks.subtitle}
        />

        <ol className="relative mt-16 grid gap-10 md:grid-cols-3">
          {/* Connecting rail (decorative), fills with scroll progress. */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-6 hidden h-0.5 bg-base-content/10 md:block"
          >
            <div
              className="h-full origin-left bg-primary"
              style={{ transform: `scaleX(${railFill})` }}
            />
          </div>

          {howItWorks.steps.map((step, i) => {
            const v = visibility(progress, STEP_THRESHOLDS[i]);
            return (
              <li
                key={step.title}
                className="relative"
                style={{
                  opacity: v,
                  transform: `translateY(${(24 * (1 - v)).toFixed(1)}px)`,
                }}
              >
                <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-primary font-display text-lg font-bold text-primary-content shadow-glow">
                  {i + 1}
                </span>
                <h3 className="mt-5 font-display text-xl font-bold text-base-content">
                  {step.title}
                </h3>
                <p className="mt-2 text-base-content/70">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export default HowItWorks;
