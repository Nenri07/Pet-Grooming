import * as React from 'react';

/**
 * Shared page frame for every Groomer Portal page.
 *
 * Every portal page uses the SAME container width and the SAME header, so the
 * page title and content start at the same left edge on every tab and the type
 * scale never changes as you click around. Previously each page picked its own
 * `max-w-*` and centred it, which made titles jump and left wide empty margins.
 *
 * Use `PAGE_CLASS` on the outermost element of a page (add `flex flex-col
 * gap-6` etc. as needed) and `PageHeader` for the title block.
 */
export const PAGE_CLASS = 'mx-auto w-full max-w-7xl';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional right-aligned actions (buttons) on the title row. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={['mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className].filter(Boolean).join(' ')}>
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-base-content sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-base-content/60 sm:text-base">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export default PageHeader;
