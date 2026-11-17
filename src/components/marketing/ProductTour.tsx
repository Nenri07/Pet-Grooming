"use client";

import * as React from "react";
import { ExternalLink, Play } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { productTour, type TourItem } from "@/content/product-tour";

/**
 * ProductTour: "See it in action". Shows product demos from
 * `content/product-tour.ts`: an interactive Supademo, a video, or a sandboxed
 * HTML page.
 *
 * - Renders nothing while the list is empty (no unfinished placeholder).
 * - Interactive demos are a click-to-load card: no third-party page or script
 *   loads until the visitor presses start, so the landing page stays fast and
 *   no third-party cookies are set on a plain visit.
 * - The loaded frame is sandboxed: it keeps its own origin (so the demo works)
 *   but cannot touch this site's cookies, storage or navigation.
 * - On phones the recorded screens are too small to read inline, so the same
 *   button opens the demo full screen in a new tab instead.
 * - With several items it shows accessible tabs.
 */

const SUPADEMO = "https://app.supademo.com";
// Frame proportions follow Supademo's own embed code: the recorded screens
// plus their 41px control bar. Applied from md up, where the demo loads inline;
// below md the card just sizes to its content.
const SUPADEMO_ID = /^[a-z0-9]{20,32}$/i;
const SANDBOX = [
  "allow-scripts",
  "allow-same-origin",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-forms",
  "allow-presentation",
].join(" ");

function supademoUrls(demoId: string) {
  if (!SUPADEMO_ID.test(demoId)) return null;
  return {
    embed: `${SUPADEMO}/embed/${demoId}?embed_v=2&utm_source=embed`,
    share: `${SUPADEMO}/demo/${demoId}`,
  };
}

function SupademoPanel({
  item,
}: {
  item: Extract<TourItem, { kind: "supademo" }>;
}) {
  const [started, setStarted] = React.useState(false);
  // The demo takes a few seconds to appear; show a message until the frame loads.
  const [loaded, setLoaded] = React.useState(false);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const urls = supademoUrls(item.demoId);

  React.useEffect(() => {
    if (started) frameRef.current?.focus();
  }, [started]);

  if (!urls) return null;

  return (
    <div>
      <div
        className={[
          "relative w-full overflow-hidden rounded-xl border border-base-300 bg-base-200 md:pb-[calc(48.7%_+_41px)]",
          // Safety net if the window is narrowed after the demo has started.
          started ? "max-md:min-h-[26rem]" : "",
        ].join(" ")}
      >
        {started ? (
          <>
            {!loaded && (
              <div
                role="status"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-base-content/60"
              >
                <span
                  className="loading loading-spinner loading-md text-primary"
                  aria-hidden="true"
                />
                Loading the demo&hellip;
              </div>
            )}
            <iframe
              ref={frameRef}
              onLoad={() => setLoaded(true)}
              title={`Interactive demo: ${item.title}`}
              src={urls.embed}
              sandbox={SANDBOX}
              allow="clipboard-write; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className={[
                "absolute inset-0 h-full w-full border-0 transition-opacity duration-300",
                loaded ? "opacity-100" : "opacity-0",
              ].join(" ")}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center sm:gap-4 md:absolute md:inset-0 md:py-6">
            <span
              aria-hidden="true"
              className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content sm:h-16 sm:w-16"
            >
              <Play
                className="ml-0.5 h-6 w-6 sm:h-7 sm:w-7"
                fill="currentColor"
                strokeWidth={0}
              />
            </span>
            <p className="font-display text-xl font-semibold text-base-content sm:text-2xl">
              {item.title}
            </p>
            <p className="max-w-md text-sm text-base-content/60">
              Click through the real product with sample data. No sign-up
              needed.
            </p>
            {/* md and up: load the demo right here. */}
            <button
              type="button"
              onClick={() => setStarted(true)}
              className="btn btn-primary hidden min-h-[44px] rounded-full border-0 px-6 md:inline-flex"
            >
              Start the interactive demo
            </button>
            {/* Below md the inline frame is too small to read: open it full screen. */}
            <a
              href={urls.share}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary min-h-[44px] rounded-full border-0 px-6 md:hidden"
            >
              Open the demo
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        )}
      </div>
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-base-content/50">
        <span>Sample data</span>
        <a
          href={urls.share}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline-offset-2 hover:text-base-content hover:underline max-md:hidden"
        >
          Open full screen
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
        <span>Interactive demo hosted by Supademo</span>
      </p>
    </div>
  );
}

function MediaPanel({
  item,
}: {
  item: Exclude<TourItem, { kind: "supademo" }>;
}) {
  return (
    <div>
      <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-base-300 bg-base-200">
        {item.kind === "video" ? (
          <video
            key={item.id}
            className="h-full w-full object-cover"
            src={item.src}
            poster={item.poster}
            controls
            playsInline
            preload="metadata"
          >
            Your browser can&apos;t play this video.
          </video>
        ) : (
          <iframe
            key={item.id}
            title={item.title}
            src={item.src}
            loading="lazy"
            // Scripts may run, but with no same-origin access to this site.
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
          />
        )}
      </div>
      <p className="mt-3 text-center text-xs text-base-content/50">
        Sample data
      </p>
    </div>
  );
}

export function ProductTour() {
  const items = productTour;
  const [active, setActive] = React.useState(0);

  if (items.length === 0) return null;
  const current = items[Math.min(active, items.length - 1)];

  return (
    <section
      id="tour"
      aria-labelledby="tour-heading"
      className="scroll-mt-28 border-y border-base-300 bg-base-100 py-band"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeading
          eyebrow="See it in action"
          title="From booking link to booked day"
          subtitle="A short look at the real product, using sample data."
          titleId="tour-heading"
        />

        {items.length > 1 && (
          <div
            role="tablist"
            aria-label="Product tour"
            className="mt-10 flex flex-wrap justify-center gap-2"
          >
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
                  "min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors",
                  i === active
                    ? "border-primary bg-primary text-primary-content"
                    : "border-base-300 bg-base-100 text-base-content/70 hover:border-primary/40",
                ].join(" ")}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}

        <div
          id={`tour-panel-${current.id}`}
          role={items.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={
            items.length > 1 ? `tour-tab-${current.id}` : undefined
          }
          className="mx-auto mt-8 max-w-5xl"
        >
          <p className="mb-4 text-center text-base text-base-content/70">
            {current.description}
          </p>
          {current.kind === "supademo" ? (
            <SupademoPanel key={current.id} item={current} />
          ) : (
            <MediaPanel key={current.id} item={current} />
          )}
        </div>
      </div>
    </section>
  );
}

export default ProductTour;
