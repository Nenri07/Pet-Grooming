import * as React from 'react';
import { MotionProvider } from '@/components/motion';

/**
 * (booking-standalone) route group shell.
 *
 * A deliberately BARE layout for the public booking page (`/book/[slug]`): it
 * does NOT render the marketing header/footer, so a client landing on a
 * groomer's booking link sees only that groomer's own branding (logo + name,
 * rendered by the page itself) — not the Pawxis marketing chrome. This keeps
 * the booking experience focused and white-labelled per groomer.
 *
 * MotionProvider is still included so Lenis smooth scroll + the reveal guards
 * work (the booking flow scrolls to the top on each step). It is SSR-safe and a
 * no-op under reduced motion.
 */
export default function BookingStandaloneLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MotionProvider>
      <div className="min-h-screen bg-base-200 text-base-content">{children}</div>
    </MotionProvider>
  );
}
