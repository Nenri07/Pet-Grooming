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
  MessageSquare,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { SmsCreditsPill } from './SmsCreditsPill';

/**
 * PortalNav — the authenticated Groomer_Portal navigation shell (Master Spec §8).
 *
 * Layout:
 *  - Desktop / tablet (md+): a COLLAPSIBLE left sidebar. A toggle narrows it to
 *    an icons-only rail; the collapsed state is persisted in localStorage so it
 *    survives reloads and route changes.
 *  - Mobile (<md): a fixed BOTTOM TAB BAR with five primary destinations —
 *    Today, Calendar, Inbox, Clients, More. "More" opens a bottom sheet holding
 *    the secondary destinations (Services / Availability / Analytics / Settings)
 *    plus the theme toggle.
 *  - A TOP BAR (all sizes) holds a search affordance, the SMS credits meter
 *    placeholder, the theme toggle and an avatar/initials link to settings.
 *
 * Motion is calm (CSS transitions only, ≤300ms). Every interactive element
 * meets the 44×44px touch-target minimum. Colors are theme tokens only.
 *
 * _Master Spec: §8 (Portal UI). Requirements: 18.2, 19.1, 19.2._
 */

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Full destination set for the desktop sidebar. */
const SIDEBAR_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Appointments', href: '/appointments', icon: CalendarDays },
  { label: 'Inbox', href: '/inbox', icon: MessageSquare },
  { label: 'Clients', href: '/clients', icon: Users },
  { label: 'Services', href: '/services', icon: Scissors },
  { label: 'Availability', href: '/availability', icon: Clock },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { label: 'Settings', href: '/settings', icon: Settings },
];

/** Five primary destinations for the mobile bottom tab bar. */
const BOTTOM_TABS: NavItem[] = [
  { label: 'Today', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Calendar', href: '/appointments', icon: CalendarDays },
  { label: 'Inbox', href: '/inbox', icon: MessageSquare },
  { label: 'Clients', href: '/clients', icon: Users },
];

/** Secondary destinations surfaced through the mobile "More" sheet. */
const MORE_ITEMS: NavItem[] = [
  { label: 'Services', href: '/services', icon: Scissors },
  { label: 'Availability', href: '/availability', icon: Clock },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { label: 'Settings', href: '/settings', icon: Settings },
];

const COLLAPSE_STORAGE_KEY = 'pawport-portal-sidebar-collapsed';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Read the persisted collapsed flag (client-only; safe during SSR). */
function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** A compact search affordance that routes to /clients with a query. */
function SearchAffordance() {
  const [value, setValue] = React.useState('');

  return (
    <form
      action="/clients"
      method="get"
      role="search"
      className="relative hidden min-w-0 flex-1 sm:block sm:max-w-xs"
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/40"
        aria-hidden="true"
      />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search clients…"
        aria-label="Search clients"
        className="input input-bordered h-11 w-full rounded-btn border-base-content/10 bg-base-200 pl-9 text-sm focus:border-primary focus:outline-none"
      />
    </form>
  );
}

/** Avatar/initials button linking to Settings. */
function AvatarMenu() {
  return (
    <Link
      href="/settings"
      aria-label="Account settings"
      title="Account settings"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-content transition-transform hover:scale-[1.03]"
    >
      <span aria-hidden="true">PP</span>
    </Link>
  );
}

export function PortalNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);

  // Hydrate the persisted collapsed state after mount (avoids SSR mismatch).
  React.useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  // Close the mobile "More" sheet whenever the route changes.
  React.useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore storage errors (private mode, etc.) */
      }
      return next;
    });
  }, []);

  return (
    <>
      {/* ---- Top bar (all sizes) ---- */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-base-content/10 bg-base-100/80 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-base-100/60 sm:px-4 md:hidden">
        <Link href="/dashboard" className="font-display text-xl font-bold text-primary">
          PawPort
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <SmsCreditsPill />
          <ThemeToggle />
          <AvatarMenu />
        </div>
      </header>

      {/* ---- Desktop / tablet collapsible sidebar (md+) ---- */}
      <aside
        className={cx(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-base-content/10 bg-base-100 p-3 transition-[width] duration-200 ease-out md:flex',
          collapsed ? 'w-[76px]' : 'w-64'
        )}
      >
        <div
          className={cx(
            'mb-4 flex items-center gap-2',
            collapsed ? 'justify-center' : 'justify-between'
          )}
        >
          {!collapsed && (
            <Link
              href="/dashboard"
              className="font-display text-2xl font-bold text-primary"
            >
              PawPort
            </Link>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1" aria-label="Portal">
          {SIDEBAR_ITEMS.map(({ label, href, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? label : undefined}
                className={cx(
                  'flex min-h-[44px] items-center gap-3 rounded-box px-3 py-2 text-base font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  active
                    ? 'bg-primary text-primary-content shadow-glow'
                    : 'text-base-content hover:bg-base-200'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar footer: SMS pill + theme + avatar (calm, tokenized). */}
        <div
          className={cx(
            'mt-3 flex items-center gap-2 border-t border-base-content/10 pt-3',
            collapsed ? 'flex-col' : 'justify-between'
          )}
        >
          {!collapsed && <SmsCreditsPill />}
          <div className={cx('flex items-center gap-1', collapsed && 'flex-col')}>
            <ThemeToggle />
            <AvatarMenu />
          </div>
        </div>
      </aside>

      {/* ---- Desktop top search strip (md+): keeps search reachable without a
             separate header row on every page. ---- */}
      <div className="pointer-events-none fixed right-4 top-3 z-20 hidden md:block">
        <div className="pointer-events-auto">
          <SearchAffordance />
        </div>
      </div>

      {/* ---- Mobile bottom tab bar (<md) ---- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-base-content/10 bg-base-100/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {BOTTOM_TABS.map(({ label, href, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex min-h-[56px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-2 text-[11px] font-medium transition-colors',
                active ? 'text-primary' : 'text-base-content/60'
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More navigation"
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className={cx(
            'flex min-h-[56px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-2 text-[11px] font-medium transition-colors',
            MORE_ITEMS.some((i) => isActive(pathname, i.href))
              ? 'text-primary'
              : 'text-base-content/60'
          )}
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {/* ---- Mobile "More" bottom sheet ---- */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="More navigation"
        >
          <div
            className="absolute inset-0 bg-neutral/40"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-box border-t border-base-content/10 bg-base-100 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-base-content">
                More
              </h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MORE_ITEMS.map(({ label, href, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex min-h-[56px] items-center gap-3 rounded-box px-4 py-3 text-base font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-content'
                        : 'bg-base-200 text-base-content hover:bg-base-300'
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-base-content/10 pt-4">
              <SmsCreditsPill />
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default PortalNav;
