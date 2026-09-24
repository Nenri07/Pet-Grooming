'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

/**
 * ThemeToggle — a client subcomponent that flips between the PawPort light and
 * dark DaisyUI themes using next-themes' `useTheme`. The change applies
 * immediately without a page reload and the selection is persisted by the
 * ThemeProvider (storageKey "pawport-theme").
 *
 * Rendered inside the (portal) layout so the toggle is available from every
 * authenticated portal page.
 *
 * Requirements: 18.2 (immediate toggle without reload), 18.3 (persist),
 * 19.2 (>=44x44px touch target).
 */
export function ThemeToggle() {
  // Avoid hydration mismatch: next-themes resolves the active theme on the
  // client, so we only reflect the icon once mounted.
  const [mounted, setMounted] = React.useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const current = theme ?? resolvedTheme ?? 'pawport_light';
  const isDark = current === 'pawport_dark';

  function toggle() {
    setTheme(isDark ? 'pawport_light' : 'pawport_dark');
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
    >
      {mounted && isDark ? (
        <Sun className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Moon className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}

export default ThemeToggle;
