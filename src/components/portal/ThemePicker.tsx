'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Check } from 'lucide-react';
import { THEMES, defaultTheme, type ThemeDef } from '@/styles/themes';

/**
 * ThemePicker — a DaisyUI-generator-style theme gallery.
 *
 * Renders every {@link THEMES} entry as a selectable card showing the theme
 * label and a row of primary/secondary/accent/base color swatches. Clicking a
 * card calls next-themes' `setTheme(id)`, which swaps `data-theme` on <html>
 * immediately (no reload) and persists the choice under "pawport-theme". Since
 * the whole site is driven by `data-theme`, this recolors BOTH the marketing
 * site and the portal.
 *
 * A mounted-guard defers the "active" highlight until after hydration so the
 * server and first client render match (next-themes resolves the stored theme
 * only on the client).
 *
 * Every card is a real <button> ≥44px tall, reachable and operable by keyboard,
 * with `aria-pressed` reflecting the active theme.
 *
 * Requirements: 18.2 (immediate, no reload), 18.3 (persist), 19.2 (44px targets).
 */
export function ThemePicker() {
  const [mounted, setMounted] = React.useState(false);
  const { theme, setTheme } = useTheme();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const active = mounted ? (theme ?? defaultTheme) : undefined;

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {THEMES.map((t) => (
        <ThemeCard
          key={t.id}
          theme={t}
          selected={active === t.id}
          onSelect={() => setTheme(t.id)}
        />
      ))}
    </div>
  );
}

function ThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: ThemeDef;
  selected: boolean;
  onSelect: () => void;
}) {
  const { swatch, label, id } = theme;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`Use the ${label} theme`}
      onClick={onSelect}
      className={[
        'flex min-h-[44px] items-center justify-between gap-3 rounded-box border p-3 text-left transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        selected
          ? 'border-primary ring-2 ring-primary/40 bg-base-200'
          : 'border-base-content/10 bg-base-100 hover:bg-base-200',
      ].join(' ')}
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex overflow-hidden rounded-full border border-base-content/10"
        >
          <Swatch color={swatch.base} />
          <Swatch color={swatch.primary} />
          <Swatch color={swatch.secondary} />
          <Swatch color={swatch.accent} />
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-medium text-base-content">{label}</span>
          <span className="text-xs text-base-content/50">{id}</span>
        </span>
      </span>
      {selected && (
        <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      )}
    </button>
  );
}

/** A single 22px color chip. Colors are inline (theme-independent previews). */
function Swatch({ color }: { color: string }) {
  return (
    <span
      className="block h-[22px] w-[22px]"
      style={{ backgroundColor: color }}
    />
  );
}

export default ThemePicker;
