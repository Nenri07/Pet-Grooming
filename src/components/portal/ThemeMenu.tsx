'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Palette, Check } from 'lucide-react';
import { THEMES, defaultTheme } from '@/styles/themes';

/**
 * ThemeMenu — a compact theme dropdown of swatches.
 *
 * A small trigger button opens a popover listing every theme with its swatch
 * row + label; picking one calls next-themes' `setTheme(id)` (immediate swap of
 * `data-theme`, persisted under "pawport-theme"). Used in the portal top bar
 * and the marketing footer so the full palette is reachable without opening
 * Settings.
 *
 * Closes on outside-click and Escape. Mounted-guard defers the active tick to
 * after hydration. Trigger is a 44px target; each option is a 44px row.
 *
 * Requirements: 18.2, 18.3, 19.2.
 */
export function ThemeMenu({ align = 'end' }: { align?: 'start' | 'end' }) {
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const { theme, setTheme } = useTheme();
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = mounted ? (theme ?? defaultTheme) : undefined;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Choose color theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose color theme"
        className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
      >
        <Palette className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Color theme"
          className={[
            'absolute bottom-full z-50 mb-2 max-h-[70vh] w-60 overflow-auto rounded-box border border-base-content/10 bg-base-100 p-2 shadow-card',
            align === 'end' ? 'right-0' : 'left-0',
          ].join(' ')}
        >
          {THEMES.map((t) => {
            const selected = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
                className={[
                  'flex min-h-[44px] w-full items-center gap-3 rounded-btn px-2 py-2 text-left text-sm transition-colors',
                  selected
                    ? 'bg-base-200 font-medium text-base-content'
                    : 'text-base-content/80 hover:bg-base-200',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className="flex overflow-hidden rounded-full border border-base-content/10"
                >
                  <span className="block h-4 w-4" style={{ backgroundColor: t.swatch.base }} />
                  <span className="block h-4 w-4" style={{ backgroundColor: t.swatch.primary }} />
                  <span className="block h-4 w-4" style={{ backgroundColor: t.swatch.secondary }} />
                  <span className="block h-4 w-4" style={{ backgroundColor: t.swatch.accent }} />
                </span>
                <span className="flex-1 truncate">{t.label}</span>
                {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ThemeMenu;
