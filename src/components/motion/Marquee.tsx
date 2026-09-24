'use client';
import * as React from 'react';
import { useGsapContext } from '@/lib/animation';

type Props = React.PropsWithChildren<{
  className?: string;
  /** Seconds for one full loop of a single copy (lower = faster). Default 20. */
  speed?: number;
  /** Scroll direction of the content. Default 'left'. */
  direction?: 'left' | 'right';
  /** Gap between the two copies (any CSS length). Default '2rem'. */
  gap?: string;
}>;

/**
 * Marquee — seamless infinite horizontal marquee owned by GSAP.
 *
 * The content is duplicated so that when the first copy scrolls fully out of
 * view the second copy is already in place, giving a gap-free loop. GSAP owns
 * the `xPercent` transform on the inner track (never shared with Framer).
 *
 * Under reduced motion the track is left static (no movement) per Section 6.3,
 * and the duplicate copy is hidden from assistive tech via aria-hidden.
 */
export function Marquee({
  children,
  className,
  speed = 20,
  direction = 'left',
  gap = '2rem',
}: Props) {
  const scopeRef = useGsapContext(
    ({ gsap, reduced, scope }) => {
      if (reduced) return; // static; no movement under reduced motion

      const track = scope.querySelector<HTMLElement>('[data-marquee-track]');
      if (!track) return;

      // The track holds two identical copies side by side. Moving it by 50%
      // of its own width lands exactly on the start of the second copy, so we
      // can wrap seamlessly.
      const from = direction === 'left' ? 0 : -50;
      const to = direction === 'left' ? -50 : 0;

      gsap.fromTo(
        track,
        { xPercent: from },
        {
          xPercent: to,
          ease: 'none',
          duration: speed,
          repeat: -1,
        }
      );
    },
    [speed, direction]
  );

  return (
    <div
      ref={scopeRef as React.RefObject<HTMLDivElement>}
      className={['overflow-hidden', className].filter(Boolean).join(' ')}
    >
      <div
        data-marquee-track
        className="flex w-max flex-nowrap will-change-transform"
        style={{ gap }}
      >
        <div className="flex flex-nowrap items-center" style={{ gap }}>
          {children}
        </div>
        <div
          className="flex flex-nowrap items-center"
          style={{ gap }}
          aria-hidden="true"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default Marquee;
