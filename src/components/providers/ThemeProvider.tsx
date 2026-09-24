'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * ThemeProvider wraps the app with next-themes, applying the selected theme via
 * the `data-theme` attribute so DaisyUI picks it up. Persists the choice to
 * localStorage under "pawport-theme" and restores it on subsequent visits.
 *
 * Requirements: 18.2 (immediate toggle without reload), 18.3 (persist selection),
 * 18.4 (default to light when no preference stored).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      themes={['pawport_light', 'pawport_dark']}
      defaultTheme="pawport_light"
      enableSystem={false}
      storageKey="pawport-theme"
    >
      {children}
    </NextThemeProvider>
  );
}
