'use client';
import * as React from 'react';
import { gsap } from 'gsap';
import { useAnimationReady, useReducedMotion } from '@/lib/animation';

/**
 * OrderRadarShowcase (Section 7.3) — the page centrepiece.
 *
 * A pinned "map" panel. As the user scrolls through the pinned distance, route
 * stops appear one by one, a new order pin drops in, and an Order Radar card
 * slides in reading the booking summary with Accept / Decline pills.
 *
 * Motion ownership:
 *   - GSAP + ScrollTrigger own the PIN and the scroll PROGRESS (0..1). Progress
 *     is pushed into React state; the individual pins/card derive their own
 *     opacity/transform from that progress. GSAP never animates the same nodes
 *     the derived styles touch, so there is no dual-owner conflict.
 *   - No Framer on this subtree.
 *
 * Reduced motion / JS-off / SSR: the map renders in its FINAL composed state
 * (all stops, the new pin, and the card fully visible). The pin is created only
 * when motion is allowed; otherwise `progress` stays at 1 so everything shows.
 */

/** Route stops as percentage coordinates within the map panel. */
const STOPS = [
  { x: 18, y: 72, time: '09:30' },
  { x: 40, y: 46, time: '11:00' },
  { x: 68, y: 58, time: '13:15' },
];

/** The incoming booking pin (the "new order"). */
const NEW_PIN = { x: 82, y: 30 };

/** Reveal threshold (0..1) at which each element becomes visible. */
const STOP_THRESHOLDS = [0.12, 0.3, 0.48];
const PIN_THRESHOLD = 0.62;
const CARD_THRESHOLD = 0.78;

/** Map a progress value + threshold to a 0..1 eased visibility factor. */
function visibility(progress: number, threshold: number, ramp = 0.12) {
  const t = (progress - threshold) / ramp;
  return Math.max(0, Math.min(1, t));
}

export function OrderRadarShowcase() {
  const ready = useAnimationReady();
  const reduced = useReducedMotion();
  const scopeRef = React.useRef<HTMLDivElement | null>(null);

  // Final state by default (SSR, JS-off, reduced motion). Only the scrubbed
  // ScrollTrigger below lowers it to 0 and animates it back up to 1.
  const [progress, setProgress] = React.useState(1);

  React.useLayoutEffect(() => {
    if (!ready || reduced || !scopeRef.current) return;
    const scope = scopeRef.current;

    const ctx = gsap.context(() => {
      setProgress(0);
      gsap.timeline({
        scrollTrigger: {
          trigger: scope,
          start: 'top top',
          end: '+=160%',
          pin: '[data-radar-pin-target]',
          pinSpacing: true,
          scrub: true,
          onUpdate: (self) => setProgress(self.progress),
          onLeaveBack: () => setProgress(0),
        },
      });
    }, scope);

    return () => {
      ctx.revert();
      setProgress(1); // restore final state after teardown
    };
  }, [ready, reduced]);

  const pinVis = visibility(progress, PIN_THRESHOLD);
  const cardVis = visibility(progress, CARD_THRESHOLD);

  return (
    <section
      id="order-radar"
      ref={scopeRef}
      aria-labelledby="order-radar-heading"
      className="relative bg-base-200"
    >
      <div
        data-radar-pin-target
        className="flex min-h-[100svh] items-center overflow-hidden"
      >
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-gutter py-section lg:grid-cols-2">
          {/* ---- Copy ---- */}
          <div className="max-w-lg">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-accent">
              Order Radar
            </p>
            <h2
              id="order-radar-heading"
              className="font-display text-h2 font-bold text-base-content"
            >
              Every booking, ranked by your route
            </h2>
            <p className="mt-4 text-lg text-base-content/70">
              When a new booking comes in, PawPort shows exactly how far it is
              from your other stops and how much driving it adds — so you can say
              yes to the ones that fit.
            </p>
          </div>

          {/* ---- Map panel ---- */}
          <div className="relative mx-auto aspect-[4/3] w-full max-w-xl rounded-box border border-base-content/10 bg-base-100 shadow-card">
            {/* Subtle grid texture (decorative). */}
            <div
              aria-hidden
              className="absolute inset-0 rounded-box bg-primary/5"
              style={{
                backgroundImage:
                  'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
                backgroundSize: '2.5rem 2.5rem',
                color: 'oklch(var(--bc) / 0.06)',
              }}
            />

            {/* Route line + stops (SVG uses percentage viewbox). */}
            <svg
              aria-hidden
              viewBox="0 0 100 75"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              {/* Route polyline connecting the stops as they appear. */}
              <polyline
                points={STOPS.map((s) => `${s.x},${s.y * 0.75}`).join(' ')}
                fill="none"
                stroke="oklch(var(--p) / 0.5)"
                strokeWidth="0.6"
                strokeDasharray="1.4 1.2"
                style={{
                  opacity: visibility(progress, STOP_THRESHOLDS[0]),
                }}
              />
              {/* Detour to the new pin. */}
              <line
                x1={STOPS[2].x}
                y1={STOPS[2].y * 0.75}
                x2={NEW_PIN.x}
                y2={NEW_PIN.y * 0.75}
                stroke="oklch(var(--a) / 0.7)"
                strokeWidth="0.6"
                strokeDasharray="1.2 1"
                style={{ opacity: pinVis }}
              />
            </svg>

            {/* Existing stops */}
            {STOPS.map((s, i) => {
              const v = visibility(progress, STOP_THRESHOLDS[i]);
              return (
                <div
                  key={s.time}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${s.x}%`,
                    top: `${s.y}%`,
                    opacity: v,
                    transform: `translate(-50%, -50%) scale(${0.6 + v * 0.4})`,
                  }}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-content shadow-glow">
                    <span className="h-2 w-2 rounded-full bg-primary-content" />
                  </span>
                  <span className="mt-1 block text-center text-[0.65rem] font-semibold tabular-nums text-base-content/70">
                    {s.time}
                  </span>
                </div>
              );
            })}

            {/* New order pin (drops in) */}
            <div
              className="absolute -translate-x-1/2"
              style={{
                left: `${NEW_PIN.x}%`,
                top: `${NEW_PIN.y}%`,
                opacity: pinVis,
                transform: `translate(-50%, ${(-16 * (1 - pinVis)).toFixed(1)}px)`,
              }}
            >
              <span className="relative flex h-6 w-6 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/50" />
                <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-content shadow-glow">
                  <span className="h-2 w-2 rounded-full bg-accent-content" />
                </span>
              </span>
            </div>

            {/* Order Radar card (slides in) */}
            <div
              className="absolute bottom-4 left-4 right-4 rounded-box border border-primary/20 bg-base-100/90 p-4 shadow-card backdrop-blur"
              style={{
                opacity: cardVis,
                transform: `translateY(${(24 * (1 - cardVis)).toFixed(1)}px)`,
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                New booking · Order Radar
              </p>
              <p className="mt-2 text-sm leading-snug text-base-content">
                4.2 km from your 11:00 stop ·{' '}
                <span className="font-semibold">+7 min driving</span>
              </p>
              <p className="mt-1 text-sm text-base-content/70">Best fit Thu 2:30</p>
              <div className="mt-3 flex gap-2">
                <span className="btn btn-primary btn-sm min-h-[44px]">Accept</span>
                <span className="btn btn-ghost btn-sm min-h-[44px] text-base-content/70">
                  Decline
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default OrderRadarShowcase;
