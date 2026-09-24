import * as React from 'react';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { MarketingFooter } from '@/components/marketing/MarketingFooter';
import { MotionProvider } from '@/components/motion';

/**
 * (public) route group shell. Wraps the marketing landing, /book/[slug], and
 * /pet-card/[id] with a shared header + footer and the central theme tokens.
 * Booking/pet-card pages keep their own inner logic; they just gain the shell.
 *
 * MotionProvider (Section 6) wraps the whole group so Lenis smooth scroll and
 * the reveal guards are active on every public page. It is SSR-safe and a no-op
 * under reduced motion, so wrapping here does not affect static rendering.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionProvider>
      <div className="flex min-h-screen flex-col bg-base-100 text-base-content">
        <MarketingHeader />
        <main className="flex-1">{children}</main>
        <MarketingFooter />
      </div>
    </MotionProvider>
  );
}
