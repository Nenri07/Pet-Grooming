'use client';

import * as React from 'react';
import { SectionHeading } from './SectionHeading';
import { productTour } from '@/content/product-tour';

/**
 * ProductTour: "See it live". Shows recorded product media (video or a
 * sandboxed HTML page) from `content/product-tour.ts`.
 *
 * Renders nothing while that list is empty, so the landing page never shows an
 * unfinished placeholder. With several items it shows accessible tabs.
 */
export function ProductTour() {
  const items = productTour;
  const [active, setActive] = React.useState(0);

  if (items.length === 0) return null;
  const current = items[Math.min(active, items.length - 1)];

  return (
    <section
      id="tour"
      aria-labelledby="tour-heading"
      className="border-y border-base-300 bg-base-100 py-band"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeading
          eyebrow="See it live"
          title="From booking link to booked day"
          subtitle="A short look at the real product, using sample data."
          titleId="tour-heading"
        />

        {items.length > 1 && (
          <div role="tablist" aria-label="Product tour" className="mt-10 flex flex-wrap justify-center gap-2">
            {items.map((item, i) => (
              <button
                key={item.id}
                id={`tour-tab-${item.id}`}
                role="tab"
                type="button"
                aria-selected={i === active}
                aria-controls={`tour-panel-${item.id}`}
                onClick={() => setActive(i)}
                className={[
                  'min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors',
                  i === active
                    ? 'border-primary bg-primary text-primary-content'
                    : 'border-base-300 bg-base-100 text-base-content/70 hover:border-primary/40',
                ].join(' ')}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}

        <div
          id={`tour-panel-${current.id}`}
          role={items.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={items.length > 1 ? `tour-tab-${current.id}` : undefined}
          className="mx-auto mt-8 max-w-5xl"
        >
          <p className="mb-4 text-center text-base text-base-content/70">{current.description}</p>
          <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-base-300 bg-base-200">
            {current.kind === 'video' ? (
              <video
                key={current.id}
                className="h-full w-full object-cover"
                src={current.src}
                poster={current.poster}
                controls
                playsInline
                preload="metadata"
              >
                Your browser can&apos;t play this video.
              </video>
            ) : (
              <iframe
                key={current.id}
                title={current.title}
                src={current.src}
                loading="lazy"
                // Scripts may run, but with no same-origin access to this site.
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                className="h-full w-full border-0"
              />
            )}
          </div>
          <p className="mt-3 text-center text-xs text-base-content/50">Sample data</p>
        </div>
      </div>
    </section>
  );
}

export default ProductTour;
