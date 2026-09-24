'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Moon, Sun, Github, Twitter, Instagram } from 'lucide-react';

/**
 * Marketing footer: nav links, social links, and a theme toggle that uses the
 * same next-themes `useTheme` mechanism as the portal ThemeToggle (immediate
 * swap, persisted by ThemeProvider under storageKey "pawport-theme").
 */
export function MarketingFooter() {
  const [mounted, setMounted] = React.useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const current = theme ?? resolvedTheme ?? 'pawport_light';
  const isDark = current === 'pawport_dark';

  function toggleTheme() {
    setTheme(isDark ? 'pawport_light' : 'pawport_dark');
  }

  const year = new Date().getFullYear();

  return (
    <footer className="bg-base-200 text-base-content">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <Link href="/" className="text-xl font-bold text-primary">
              PawPort
            </Link>
            <p className="mt-3 max-w-xs text-sm text-base-content/70">
              Luxury mobile pet grooming, booked in seconds and brought right to
              your door.
            </p>
          </div>

          <nav aria-label="Product" className="flex flex-col gap-2 text-sm">
            <span className="font-semibold text-base-content">Product</span>
            <Link href="#features" className="text-base-content/70 hover:text-primary">
              Features
            </Link>
            <Link href="#pricing" className="text-base-content/70 hover:text-primary">
              Pricing
            </Link>
            <Link href="/register" className="text-base-content/70 hover:text-primary">
              Get started
            </Link>
          </nav>

          <nav aria-label="Company" className="flex flex-col gap-2 text-sm">
            <span className="font-semibold text-base-content">Company</span>
            <Link href="/login" className="text-base-content/70 hover:text-primary">
              Log in
            </Link>
            <Link href="/credits" className="text-base-content/70 hover:text-primary">
              Credits
            </Link>
            <Link href="#" className="text-base-content/70 hover:text-primary">
              Contact
            </Link>
          </nav>

          <div className="flex flex-col gap-4">
            <span className="text-sm font-semibold text-base-content">Follow along</span>
            <div className="flex gap-2">
              <Link
                href="#"
                aria-label="Twitter"
                className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
              >
                <Twitter className="h-5 w-5" aria-hidden="true" />
              </Link>
              <Link
                href="#"
                aria-label="Instagram"
                className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
              >
                <Instagram className="h-5 w-5" aria-hidden="true" />
              </Link>
              <Link
                href="#"
                aria-label="GitHub"
                className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
              >
                <Github className="h-5 w-5" aria-hidden="true" />
              </Link>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="btn btn-ghost btn-sm min-h-[44px] justify-start gap-2"
            >
              {mounted && isDark ? (
                <>
                  <Sun className="h-5 w-5" aria-hidden="true" />
                  <span>Light mode</span>
                </>
              ) : (
                <>
                  <Moon className="h-5 w-5" aria-hidden="true" />
                  <span>Dark mode</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-base-300 pt-6 text-sm text-base-content/60 sm:flex-row sm:items-center sm:justify-between">
          <span>&copy; {year} PawPort. All rights reserved.</span>
          <span>
            Photography:{' '}
            <a
              href="https://www.pexels.com"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-primary"
            >
              Pexels
            </a>
            {' · '}
            <Link href="/credits" className="hover:text-primary">
              Photo credits
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
