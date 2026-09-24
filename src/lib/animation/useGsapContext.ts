'use client';
import * as React from 'react';
import { gsap } from 'gsap';
import { useAnimationReady } from './AnimationProvider';
import { useReducedMotion } from './useReducedMotion';

/**
 * Runs GSAP setup inside a scoped gsap.context() bound to `scopeRef`, so every
 * tween/ScrollTrigger created inside is automatically reverted on unmount
 * (prevents leaks, dead triggers, and layout shift after navigation).
 *
 * - No-ops until ScrollTrigger is registered (ready) to avoid SSR/order issues.
 * - When the user prefers reduced motion, `setup` receives reduced=true so it
 *   can skip scrubbed motion and set final states instantly.
 */
export function useGsapContext(
  setup: (ctx: { gsap: typeof gsap; reduced: boolean; scope: HTMLElement }) => void,
  deps: React.DependencyList = []
) {
  const scopeRef = React.useRef<HTMLElement | null>(null);
  const ready = useAnimationReady();
  const reduced = useReducedMotion();

  React.useLayoutEffect(() => {
    if (!ready || !scopeRef.current) return;
    const scope = scopeRef.current;
    const ctx = gsap.context(() => setup({ gsap, reduced, scope }), scope);
    return () => ctx.revert(); // cleanup: kills tweens + ScrollTriggers in scope
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reduced, ...deps]);

  return scopeRef;
}
