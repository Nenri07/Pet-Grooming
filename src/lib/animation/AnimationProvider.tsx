'use client';
import * as React from 'react';
import { gsap } from 'gsap';

/**
 * Registers ScrollTrigger exactly once on the client and exposes a `ready`
 * flag so GSAP-driven components only build timelines after registration.
 * Rendered high in the tree (root layout) but performs NO server-side work.
 */
const AnimationReadyContext = React.createContext(false);
export const useAnimationReady = () => React.useContext(AnimationReadyContext);

export function AnimationProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    // Dynamic import keeps ScrollTrigger out of the server bundle.
    import('gsap/ScrollTrigger').then(({ ScrollTrigger }) => {
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      // Defaults: no marker noise, refresh on load so triggers measure correctly.
      ScrollTrigger.config({ ignoreMobileResize: true });
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AnimationReadyContext.Provider value={ready}>
      {children}
    </AnimationReadyContext.Provider>
  );
}
