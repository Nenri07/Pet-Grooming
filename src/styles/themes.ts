/**
 * PawPort theme registry.
 *
 * Each theme id maps to a full OKLCH token block in `theme.css`
 * (`[data-theme="<id>"]`). This module is the single source of truth for the
 * theme *list* consumed by:
 *   - {@link ../components/providers/ThemeProvider} (passes ids to next-themes),
 *   - {@link ../components/portal/ThemePicker} (renders the swatch grid),
 *   - the top-bar + footer theme menus.
 *
 * Swatch colors are ready-to-render CSS `oklch(L C H)` strings that mirror the
 * primary/secondary/accent/base-100 tokens of each block, so the picker preview
 * matches what the theme actually renders — without having to read computed
 * CSS variables.
 *
 * Requirements: 18.x (theme selection, persistence, no-reload swap).
 */

/** One color chip shown in the picker preview. */
export interface ThemeSwatch {
  /** Primary token (--p). */
  primary: string;
  /** Secondary token (--s). */
  secondary: string;
  /** Accent token (--a). */
  accent: string;
  /** Base surface (--b1). */
  base: string;
}

/** A selectable theme. */
export interface ThemeDef {
  /** data-theme id, also the next-themes value + localStorage value. */
  id: string;
  /** Human label shown in pickers. */
  label: string;
  /** Preview swatch colors as `oklch(...)` strings. */
  swatch: ThemeSwatch;
}

/**
 * All selectable themes, in display order. Swatch values are copied from the
 * matching `[data-theme]` block in theme.css (L C H → `oklch(L C H)`).
 */
export const THEMES: readonly ThemeDef[] = [
  {
    id: 'pawport_light',
    label: 'Ivory Spa',
    swatch: {
      primary: 'oklch(42% 0.11 255)',
      secondary: 'oklch(74% 0.08 170)',
      accent: 'oklch(80% 0.09 15)',
      base: 'oklch(98.5% 0.008 85)',
    },
  },
  {
    id: 'pawport_dark',
    label: 'Midnight Spa',
    swatch: {
      primary: 'oklch(74% 0.12 245)',
      secondary: 'oklch(78% 0.09 175)',
      accent: 'oklch(82% 0.10 20)',
      base: 'oklch(18% 0.025 265)',
    },
  },
  {
    id: 'pawport_meadow',
    label: 'Fresh Meadow',
    swatch: {
      primary: 'oklch(52% 0.12 150)',
      secondary: 'oklch(68% 0.09 130)',
      accent: 'oklch(78% 0.11 75)',
      base: 'oklch(98.5% 0.012 130)',
    },
  },
  {
    id: 'pawport_sand',
    label: 'Golden Sand',
    swatch: {
      primary: 'oklch(58% 0.13 55)',
      secondary: 'oklch(72% 0.10 40)',
      accent: 'oklch(66% 0.14 25)',
      base: 'oklch(98% 0.016 75)',
    },
  },
  {
    id: 'pawport_blossom',
    label: 'Soft Blossom',
    swatch: {
      primary: 'oklch(60% 0.15 355)',
      secondary: 'oklch(74% 0.09 330)',
      accent: 'oklch(80% 0.09 30)',
      base: 'oklch(99% 0.01 350)',
    },
  },
  {
    id: 'pawport_ocean',
    label: 'Fresh Bath',
    swatch: {
      primary: 'oklch(56% 0.11 210)',
      secondary: 'oklch(72% 0.10 185)',
      accent: 'oklch(80% 0.09 70)',
      base: 'oklch(98.5% 0.012 200)',
    },
  },
  {
    id: 'pawport_charcoal',
    label: 'Luxe Charcoal',
    swatch: {
      primary: 'oklch(80% 0.13 75)',
      secondary: 'oklch(72% 0.06 40)',
      accent: 'oklch(78% 0.12 55)',
      base: 'oklch(20% 0.006 60)',
    },
  },
] as const;

/** All theme ids, in display order. */
export const themeIds = THEMES.map((t) => t.id);

/**
 * Backwards-compatible alias. Older call sites imported `themes`; it stays a
 * flat id list so nothing breaks.
 */
export const themes = themeIds;

/** The dark-scheme themes (color-scheme: dark), handy for icon/label choices. */
export const darkThemes = new Set<string>(['pawport_dark', 'pawport_charcoal']);

/** Default theme when no preference is stored. */
export const defaultTheme = 'pawport_light';

/** Look up a theme definition by id. */
export function getTheme(id: string | undefined | null): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id);
}
