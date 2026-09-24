'use client';
import * as React from 'react';
import { usePathname } from 'next/navigation';
import {
  PageTransition as BasePageTransition,
  stepTransition,
} from '@/components/ui/PageTransition';

type Props = {
  children: React.ReactNode;
  className?: string;
};

/**
 * PageTransition — route-level fade/slide transition (<=400ms) keyed by the
 * current pathname. Thin wrapper over the existing, well-tested
 * `@/components/ui/PageTransition` (which handles graceful degradation if
 * Framer fails to load) so we don't duplicate its logic; here we just supply
 * the pathname as the transition key.
 */
export function PageTransition({ children, className }: Props) {
  const pathname = usePathname();
  return (
    <BasePageTransition transitionKey={pathname ?? ''} className={className}>
      {children}
    </BasePageTransition>
  );
}

// Re-export the multi-step transition preset for booking/step flows.
export { stepTransition };
export default PageTransition;
