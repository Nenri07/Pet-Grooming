'use client';
import * as React from 'react';

/**
 * SSR-safe prefers-reduced-motion hook.
 * Returns false during SSR/first paint, then resolves the real value on mount,
 * and updates live if the OS setting changes.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return reduced;
}
