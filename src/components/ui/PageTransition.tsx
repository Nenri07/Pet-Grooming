'use client';

import * as React from 'react';

/**
 * PageTransition — Framer Motion powered wrapper for page navigation and
 * multi-step form transitions.
 *
 * Requirements:
 * - 18.7: Apply Framer Motion transitions with a duration between 200ms and
 *   400ms for page navigation and multi-step form transitions.
 * - 18.8: IF Framer Motion fails to load or execute, THEN allow page
 *   navigation and multi-step form transitions to proceed WITHOUT animated
 *   transitions (graceful degradation).
 *
 * Graceful degradation strategy:
 * - framer-motion is imported dynamically and lazily. If the module fails to
 *   load, or if rendering the animated tree throws, we fall back to rendering
 *   the children in a plain <div>. Navigation is never blocked by animation.
 */

/** Page-level transition variants (300ms, within the 200-400ms window). */
const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const pageTransitionConfig = { duration: 0.3, ease: 'easeInOut' as const };

/**
 * Booking step transition variant (350ms, within the 200-400ms window).
 * Exported for use by multi-step booking flow components.
 */
export const stepTransition = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.35, ease: 'easeInOut' as const },
};

interface PageTransitionProps {
  /** Unique key identifying the current page/step; drives exit/enter animation. */
  transitionKey: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Error boundary that ensures a failure inside the animated subtree never
 * blocks rendering. On error we render the raw children unanimated (Req 18.8).
 */
class AnimationErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Animation failure is non-fatal; log for diagnostics and degrade gracefully.
    // eslint-disable-next-line no-console
    console.warn('PageTransition animation failed; rendering without animation.', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Lazily-loaded animated implementation. Kept in a separate component so that
 * a failure to load framer-motion is contained by React.Suspense + the error
 * boundary, and the unanimated fallback is shown instead.
 */
const AnimatedTransition = React.lazy(async () => {
  const { motion, AnimatePresence } = await import('framer-motion');

  function Animated({ transitionKey, children, className }: PageTransitionProps) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={transitionKey}
          className={className}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={pageTransitionConfig}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    );
  }

  return { default: Animated };
});

export function PageTransition({ transitionKey, children, className }: PageTransitionProps) {
  // The unanimated fallback renders children immediately so navigation is never
  // blocked while framer-motion loads or if it fails entirely (Req 18.8).
  const fallback = <div className={className}>{children}</div>;

  return (
    <AnimationErrorBoundary fallback={fallback}>
      <React.Suspense fallback={fallback}>
        <AnimatedTransition transitionKey={transitionKey} className={className}>
          {children}
        </AnimatedTransition>
      </React.Suspense>
    </AnimationErrorBoundary>
  );
}

export default PageTransition;
