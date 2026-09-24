'use client';
import * as React from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useReducedMotion } from '@/lib/animation';

type Props = React.PropsWithChildren<{
  className?: string;
  /** Max rotation in degrees at the card edges. Default 12. */
  max?: number;
  /** Perspective distance in px. Default 800. */
  perspective?: number;
}>;

/**
 * Tilt — Framer Motion 3D card tilt that follows the pointer on hover.
 *
 * Pointer position is mapped to rotateX/rotateY via useMotionValue +
 * useTransform (Framer owns these transforms). Movement is spring-smoothed and
 * resets to flat on pointer leave.
 *
 * Under reduced motion the effect is disabled entirely: the card renders flat
 * and pointer handlers are no-ops per Section 6.3.
 */
export function Tilt({ children, className, max = 12, perspective = 800 }: Props) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);

  // Normalised pointer position within the element, -0.5..0.5.
  const px = useMotionValue(0);
  const py = useMotionValue(0);

  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [max, -max]), {
    stiffness: 200,
    damping: 20,
  });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-max, max]), {
    stiffness: 200,
    damping: 20,
  });

  const handleMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reduced) return;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      px.set((e.clientX - rect.left) / rect.width - 0.5);
      py.set((e.clientY - rect.top) / rect.height - 0.5);
    },
    [reduced, px, py]
  );

  const handleLeave = React.useCallback(() => {
    px.set(0);
    py.set(0);
  }, [px, py]);

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div style={{ perspective }} className={className}>
      <motion.div
        ref={ref}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      >
        {children}
      </motion.div>
    </div>
  );
}

export default Tilt;
