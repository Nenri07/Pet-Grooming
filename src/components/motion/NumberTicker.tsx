'use client';
import * as React from 'react';
import { animate, useInView } from 'framer-motion';
import { useReducedMotion } from '@/lib/animation';

type Props = {
  /** The final value to display / count up to. */
  value: number;
  prefix?: string;
  suffix?: string;
  /** Decimal places for formatting. Default 0. */
  decimals?: number;
  className?: string;
};

function format(n: number, decimals: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * NumberTicker — count-up number that is SEO/SSR correct.
 *
 * CRITICAL (Section 6.3): the server-rendered and initial-paint text is the
 * FINAL formatted value, not 0 — this fixes the "0+ / 0%" bug where counters
 * shipped a zero to crawlers and JS-off users. Only after hydration, when the
 * element scrolls into view, does it briefly animate from 0 to the value.
 *
 * Under reduced motion no animation runs; the final value simply stays.
 */
export function NumberTicker({
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
  className,
}: Props) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.5, once: true });
  const reduced = useReducedMotion();

  // Tracks whether we've hydrated. Before hydration we render the final value
  // so SSR output is correct; the count-up only begins post-hydration.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);

  React.useEffect(() => {
    if (!hydrated || reduced || !inView) return;
    const node = ref.current;
    if (!node) return;

    const controls = animate(0, value, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        node.textContent = `${prefix}${format(latest, decimals)}${suffix}`;
      },
    });

    return () => controls.stop();
  }, [hydrated, reduced, inView, value, prefix, suffix, decimals]);

  // The initial/SSR text content is always the final formatted value.
  return (
    <span ref={ref} className={className}>
      {`${prefix}${format(value, decimals)}${suffix}`}
    </span>
  );
}

export default NumberTicker;
