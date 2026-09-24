'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Scissors,
  Clock,
  BarChart3,
  Settings,
  Menu,
  X,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

/**
 * PortalNav — the authenticated Groomer_Portal navigation shell.
 *
 * Renders a persistent sidebar on tablet/desktop (>=768px) and a slide-in
 * drawer on mobile (<768px) toggled by a hamburger button. Includes a theme
 * toggle (light/dark). Every interactive element meets the 44x44px minimum
 * touch target on mobile, and the layout is mobile-first (drawer hidden by
 * default, revealed only when opened).
 *
 * Requirements: 18.2 (theme toggle), 19.1 (responsive breakpoints),
 * 19.2 (44x44px touch targets).
 */

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Clients', href: '/clients', icon: Users },
  { label: 'Appointments', href: '/appointments', icon: CalendarDays },
  { label: 'Services', href: '/services', icon: Scissors },
  { label: 'Availability', href: '/availability', icon: Clock },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { label: 'Settings', href: '/settings', icon: Settings },
];

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const navLinks = (
    <nav className="flex flex-col gap-1" aria-label="Portal">
      {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex min-h-[44px] items-center gap-3 rounded-2xl px-4 py-2 text-base font-medium transition-colors',
              active
                ? 'bg-primary text-primary-content'
                : 'text-base-content hover:bg-base-200'
            )}
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile top bar with hamburger (hidden on md+). */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-base-300 bg-base-100 px-4 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>
        <Link href="/dashboard" className="text-xl font-bold text-primary">
          PawPort
        </Link>
        <ThemeToggle />
      </header>

      {/* Desktop / tablet sidebar (hidden on mobile). */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-base-300 bg-base-100 p-4 md:flex">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/dashboard" className="text-2xl font-bold text-primary">
            PawPort
          </Link>
          <ThemeToggle />
        </div>
        {navLinks}
      </aside>

      {/* Mobile slide-in drawer + backdrop. */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-base-100 p-4 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <Link href="/dashboard" className="text-2xl font-bold text-primary">
                PawPort
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
              >
                <X className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
            {navLinks}
          </div>
        </div>
      )}
    </>
  );
}

export default PortalNav;
