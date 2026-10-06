'use client';

import * as React from 'react';
import confetti from 'canvas-confetti';
import { useReducedMotion } from '@/lib/animation/useReducedMotion';

/**
 * ConfettiBurst — fires a single, celebratory confetti burst once on mount.
 *
 * Used on the public Digital Pet Card so opening a shared card feels like a
 * little reveal. It is:
 *  - one-shot (a ref guards against React StrictMode's double-mount),
 *  - reduced-motion safe (no burst when the user prefers reduced motion),
 *  - self-contained (canvas-confetti creates its own fixed, pointer-events-none
 *    canvas and tears it down), so it renders nothing itself.
 */
export function ConfettiBurst() {
  const reduced = useReducedMotion();
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    if (reduced || firedRef.current) return;
    firedRef.current = true;

    // Two quick side-cannon bursts for a fuller, less uniform spray.
    const common = { startVelocity: 38, spread: 70, ticks: 180, zIndex: 50 } as const;
    const t = window.setTimeout(() => {
      confetti({ ...common, particleCount: 70, origin: { x: 0.15, y: 0.25 }, angle: 60 });
      confetti({ ...common, particleCount: 70, origin: { x: 0.85, y: 0.25 }, angle: 120 });
    }, 180);

    return () => window.clearTimeout(t);
  }, [reduced]);

  return null;
}

export default ConfettiBurst;
