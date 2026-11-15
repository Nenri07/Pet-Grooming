'use client';

import * as React from 'react';

export interface SettingsNavItem {
  id: string;
  label: string;
}

/**
 * Side navigation for the Settings page. Each item jumps to a section on the
 * same page. The item for the section currently in view is highlighted
 * (IntersectionObserver). On small screens it becomes a horizontal chip row.
 */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const [active, setActive] = React.useState(items[0]?.id ?? '');

  React.useEffect(() => {
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') return;

    // The section nearest the top of the viewport wins.
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        if (visible.size > 0) {
          const [first] = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
          setActive(first);
        }
      },
      { rootMargin: '-96px 0px -55% 0px', threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  return (
    <nav
      aria-label="Settings sections"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-20 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => setActive(item.id)}
            className={[
              'inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors',
              isActive
                ? 'bg-base-100 font-medium text-base-content ring-1 ring-base-300'
                : 'text-base-content/60 hover:bg-base-100/70 hover:text-base-content',
            ].join(' ')}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

export default SettingsNav;
