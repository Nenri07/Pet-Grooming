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
    label: 'Light',
    swatch: {
      primary: 'oklch(48% 0.13 195)',
      secondary: 'oklch(60% 0.10 175)',
      accent: 'oklch(70% 0.10 40)',
      base: 'oklch(99% 0.005 85)',
    },
  },
  {
    id: 'pawport_dark',
    label: 'Dark',
    swatch: {
      primary: 'oklch(72% 0.13 195)',
      secondary: 'oklch(70% 0.10 175)',
      accent: 'oklch(75% 0.10 40)',
      base: 'oklch(14% 0.005 260)',
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
export const darkThemes = new Set<string>(['pawport_dark']);

/** Default theme when no preference is stored. */
export const defaultTheme = 'pawport_light';

/** Look up a theme definition by id. */
export function getTheme(id: string | undefined | null): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id);
}
