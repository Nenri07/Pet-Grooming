'use client';
import * as React from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { LayoutDashboard } from 'lucide-react';
import { useGsapContext } from '@/lib/animation';

/**
 * Marketing site header. GSAP ScrollTrigger toggles an "is-scrolled" class that
 * adds a translucent background, reduced height, and a soft shadow.
 *
 * Auth-aware (Requirement 1.x / UX): when a visitor is SIGNED IN, the header
 * greets them by name and swaps the "Log in" pill for a "Dashboard" button +
 * an avatar initial, so a logged-in groomer landing on the marketing site sees
 * their identity and a one-tap way back into the portal — never a stale
 * "Log in" call to action. Signed-out visitors see "Log in" as before.
 */
export function MarketingHeader() {
  const { data: session, status } = useSession();

  const scopeRef = useGsapContext(({ gsap, scope }) => {
    const el = scope.querySelector('[data-header]');
    if (!el) return;
    gsap.to(el, {
      scrollTrigger: {
        start: 'top+=40 top',
        end: 99999,
        toggleClass: { targets: el, className: 'is-scrolled' },
      },
    });
  });

  const user = session?.user;
  const authed = status === 'authenticated' && !!user;
  const displayName = user?.name || user?.email || 'there';
  const initial = (user?.name || user?.email || 'P').trim().charAt(0).toUpperCase();
  const dashboardHref = user?.onboardingComplete ? '/dashboard' : '/onboarding';

  return (
    <div ref={scopeRef as React.RefObject<HTMLDivElement>}>
      <header
        data-header
        className="fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-between px-gutter transition-[height,background-color,box-shadow] duration-300 [&.is-scrolled]:h-16 [&.is-scrolled]:bg-base-100/80 [&.is-scrolled]:shadow-soft [&.is-scrolled]:backdrop-blur"
      >
        <Link href="/" className="text-xl font-bold text-primary">
          PawPort
        </Link>

        <nav className="flex items-center gap-4 md:gap-6">
          <Link href="#features" className="hidden text-base-content hover:text-primary md:inline">
            Features
          </Link>
          <Link href="#pricing" className="hidden text-base-content hover:text-primary md:inline">
            Pricing
          </Link>

          {authed ? (
            <div className="flex items-center gap-3">
              {/* Greeting: hidden on the smallest screens to save room. */}
              <span className="hidden text-sm text-base-content/70 sm:inline">
                Hi, <span className="font-semibold text-base-content">{displayName}</span>
              </span>
              <Link
                href={dashboardHref}
                className="btn btn-sm btn-primary rounded-btn min-h-[44px] gap-2"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Dashboard</span>
                <span className="sm:hidden">Portal</span>
              </Link>
              <Link
                href="/settings"
                aria-label={`Account: ${displayName}`}
                title={displayName}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary"
              >
                {initial}
              </Link>
            </div>
          ) : (
            <Link href="/login" className="btn btn-sm btn-primary rounded-btn min-h-[44px]">
              Log in
            </Link>
          )}
        </nav>
      </header>
    </div>
  );
}