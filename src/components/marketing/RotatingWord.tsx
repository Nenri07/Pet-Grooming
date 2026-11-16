'use client';

import * as React from 'react';
import { AnimatePresence, motion, useInView, type Variants } from 'framer-motion';
import { useReducedMotion } from '@/lib/animation';

/**
 * RotatingWord: shows one word at a time and rolls to the next, e.g. the pet
 * in the hero headline ("Groom more [Poodles]. Drive less.").
 *
 * - The old word rolls up and fades out while the new one rolls in from below
 *   (both sit in the same grid cell, so they overlap instead of jumping).
 * - The box is always exactly one line tall, so the page never shifts.
 * - Starts on `words[0]` on the server and on first paint (no hydration
 *   mismatch, and what shows with JS off).
 * - Stops on `words[0]` under reduced motion.
 * - Pauses while the tab is hidden or the word is scrolled out of view.
 * - Purely visual: it is `aria-hidden`; the caller provides the static text
 *   for assistive tech so changes are never announced.
 */
const ease: [number, number, number, number] = [0.16, 1, 0.3, 1];

const roll: Variants = {
  enter: { opacity: 0, y: '0.45em', filter: 'blur(8px)' },
  center: { opacity: 1, y: '0em', filter: 'blur(0px)', transition: { duration: 0.6, ease } },
  exit: { opacity: 0, y: '-0.45em', filter: 'blur(8px)', transition: { duration: 0.45, ease } },
};

export function RotatingWord({
  words,
  suffix = '.',
  intervalMs = 2400,
  className,
}: {
  words: string[];
  /** Rendered right after each word and moves with it (e.g. the full stop). */
  suffix?: string;
  intervalMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (reduced || !inView || words.length < 2) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((i) => (i + 1) % words.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [reduced, inView, words.length, intervalMs]);

  const word = words[reduced ? 0 : index] ?? '';

  return (
    <span ref={ref} aria-hidden="true" className={['grid', className].filter(Boolean).join(' ')}>
      <AnimatePresence initial={false}>
        <motion.span
          key={word}
          variants={roll}
          initial="enter"
          animate="center"
          exit="exit"
          className="col-start-1 row-start-1 whitespace-nowrap"
        >
          {word}
          {suffix}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export default RotatingWord;
