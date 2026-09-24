'use client';
import * as React from 'react';
import { gsap } from 'gsap';
import { AnimationProvider, useAnimationReady } from '@/lib/animation';
import { useReducedMotion } from '@/lib/animation';

/**
 * MotionProvider — top-level client motion provider for the marketing site.
 *
 * Composes the existing {@link AnimationProvider} (which registers GSAP
 * ScrollTrigger exactly once) and layers on:
 *   1. Lenis smooth scroll, wired into GSAP's ticker + ScrollTrigger.
 *   2. The "visible by default" mechanism (Section 6.3): a `js-anim` class is
 *      added to <html> ONLY when reduced motion is off, so reveal CSS that
 *      hides elements only applies when JS is running. A 2s failsafe adds
 *      `anim-done` so everything becomes visible even if a script hangs.
 *
 * Non-negotiables honoured:
 *   - SSR-safe: no window/document/matchMedia touched during render; all
 *     browser access lives inside effects.
 *   - Reduced motion: Lenis is NOT initialised (native scroll only, no
 *     smoothing) and the `js-anim` hide class is never applied.
 *   - GSAP work is cleaned up on unmount (ticker callback + Lenis destroy).
 */
function LenisBridge({ children }: { children: React.ReactNode }) {
  const ready = useAnimationReady();
  const reduced = useReducedMotion();

  // ---- "visible by default" flag on <html> --------------------------------
  // Only hide-until-revealed when motion is allowed AND JS is live. Under
  // reduced motion we never add js-anim, so the reveal CSS is inert and the
  // final state renders immediately.
  React.useEffect(() => {
    if (reduced) return;
    const root = document.documentElement;
    root.classList.add('js-anim');

    // Failsafe: whatever happens, reveal everything after 2s so a hung tween
    // or a ScrollTrigger that never fires can't leave content invisible.
    const failsafe = window.setTimeout(() => {
      root.classList.add('anim-done');
    }, 2000);

    return () => {
      window.clearTimeout(failsafe);
      root.classList.remove('js-anim');
      root.classList.remove('anim-done');
    };
  }, [reduced]);

  // ---- Lenis smooth scroll <-> GSAP ticker + ScrollTrigger ----------------
  React.useEffect(() => {
    // Wait until ScrollTrigger is registered; skip entirely under reduced
    // motion (native scroll, no smoothing) per Section 6.3.
    if (!ready || reduced) return;

    let lenis: import('lenis').default | null = null;
    let tickerFn: ((time: number) => void) | null = null;
    let cancelled = false;

    // Dynamic imports keep Lenis + ScrollTrigger out of the server bundle.
    Promise.all([import('lenis'), import('gsap/ScrollTrigger')]).then(
      ([{ default: Lenis }, { ScrollTrigger }]) => {
        if (cancelled) return;

        lenis = new Lenis({
          duration: 1.1,
          smoothWheel: true,
        });

        // Keep ScrollTrigger in sync with Lenis' virtual scroll position.
        const onScroll = () => ScrollTrigger.update();
        lenis.on('scroll', onScroll);

        // Drive Lenis from GSAP's ticker (single rAF loop for everything).
        tickerFn = (time: number) => {
          lenis?.raf(time * 1000); // gsap ticker time is in seconds
        };
        gsap.ticker.add(tickerFn);
        gsap.ticker.lagSmoothing(0);
      }
    );

    return () => {
      cancelled = true;
      if (tickerFn) gsap.ticker.remove(tickerFn);
      gsap.ticker.lagSmoothing(500, 33); // restore GSAP default
      if (lenis) lenis.destroy();
      lenis = null;
      tickerFn = null;
    };
  }, [ready, reduced]);

  return <>{children}</>;
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <AnimationProvider>
      <LenisBridge>{children}</LenisBridge>
    </AnimationProvider>
  );
}

export default MotionProvider;
