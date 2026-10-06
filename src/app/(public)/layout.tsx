import * as React from 'react';
import { headers } from 'next/headers';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { MarketingFooter } from '@/components/marketing/MarketingFooter';
import { MotionProvider } from '@/components/motion';

/**
 * (public) route group shell.
 *
 * Marketing pages (landing, /for-groomers, legal) get the full marketing
 * header + footer. CLIENT-FACING SHARED pages — the ones a groomer sends to a
 * customer: the Digital Pet Card, the live tracker, the Fill-My-Day claim, and
 * the rebook link — instead render as a BARE shell (no marketing chrome). Those
 * pages draw their own top-right Pawxis-x-groomer collab mark, so the product's
 * marketing nav would only be noise to the end client.
 *
 * The layout can't read the pathname directly, so the middleware stamps it onto
 * the `x-pathname` request header, which we read here to decide the shell.
 *
 * MotionProvider (Section 6) still wraps everything so Lenis smooth scroll and
 * the reveal guards work on every public page; it is SSR-safe and a no-op under
 * reduced motion.
 */

/** Route prefixes that are client-facing shared pages (bare shell, no chrome). */
const BARE_SHELL_PREFIXES = ['/pet-card', '/t/', '/claim', '/rebook'] as const;

function isBareShellPath(pathname: string): boolean {
  return BARE_SHELL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const pathname = headers().get('x-pathname') ?? '';
  const bare = isBareShellPath(pathname);

  if (bare) {
    // Bare shell: no marketing header/footer. The page owns its full-screen
    // layout and renders the collab mark itself.
    return (
      <MotionProvider>
        <div className="min-h-screen bg-base-100 text-base-content">{children}</div>
      </MotionProvider>
    );
  }

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
