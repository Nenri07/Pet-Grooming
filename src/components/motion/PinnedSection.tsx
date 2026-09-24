'use client';
import * as React from 'react';
import { useGsapContext } from '@/lib/animation';

type Props = React.PropsWithChildren<{
  className?: string;
  /**
   * ScrollTrigger `end` value controlling how far the section stays pinned.
   * Default '+=100%' (pinned for one extra viewport of scrolling).
   */
  end?: string;
  /**
   * Pin the inner content wrapper rather than the whole scope. The scope acts
   * as the trigger/spacer; the child is what stays fixed. Default true.
   */
  pinChild?: boolean;
}>;

/**
 * PinnedSection — pins a section in place for a scroll distance using GSAP
 * ScrollTrigger, so scroll-driven timelines (e.g. Order Radar) can play while
 * the section is fixed. Created inside gsap.context so the pin + its spacer are
 * reverted on unmount.
 *
 * Under reduced motion no pin is created; the section renders as ordinary
 * static content per Section 6.3.
 */
export function PinnedSection({
  children,
  className,
  end = '+=100%',
  pinChild = true,
}: Props) {
  const scopeRef = useGsapContext(
    ({ gsap, reduced, scope }) => {
      if (reduced) return; // no pin under reduced motion

      const pinTarget = pinChild
        ? scope.querySelector<HTMLElement>('[data-pin-target]') ?? scope
        : scope;

      gsap.timeline({
        scrollTrigger: {
          trigger: scope,
          start: 'top top',
          end,
          pin: pinTarget,
          pinSpacing: true,
          scrub: true,
        },
      });
    },
    [end, pinChild]
  );

  return (
    <div ref={scopeRef as React.RefObject<HTMLDivElement>} className={className}>
      <div data-pin-target>{children}</div>
    </div>
  );
}

export default PinnedSection;
