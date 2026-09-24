'use client';
import * as React from 'react';
import { useGsapContext } from './useGsapContext';

type Props = React.PropsWithChildren<{
  className?: string;
  /** Positive = moves slower (background); negative = faster (foreground). */
  speed?: number;
}>;

/**
 * Scroll-scrubbed vertical parallax. GSAP OWNS the y transform on this node
 * (D4). It never shares a node with a Framer transform animation.
 * Automatically reverts on unmount via gsap.context; respects reduced motion.
 */
export function Parallax({ children, className, speed = 0.3 }: Props) {
  const scopeRef = useGsapContext(({ gsap, reduced, scope }) => {
    if (reduced) return; // static; no parallax under reduced-motion
    gsap.to(scope.firstElementChild, {
      yPercent: -speed * 100,
      ease: 'none',
      scrollTrigger: {
        trigger: scope,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  }, [speed]);

  return (
    <div ref={scopeRef as React.RefObject<HTMLDivElement>} className={className}>
      <div className="will-change-transform">{children}</div>
    </div>
  );
}
