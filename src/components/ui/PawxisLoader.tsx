'use client';

import * as React from 'react';
import Image from 'next/image';

/**
 * PawxisLoader — the brand loading indicator.
 *
 * Shows the Pawxis logo above an "irregular zipline" line that draws/fills
 * itself left-to-right in the theme's primary colour, looping ~1.4s. Under
 * `prefers-reduced-motion: reduce` the line is shown fully drawn and static.
 *
 * Colours come exclusively from DaisyUI theme tokens (`stroke-primary`,
 * `bg-base-100`, `text-base-content`) — no hardcoded hex.
 */

interface PawxisLoaderProps {
  /** When true, render a fixed full-viewport centered overlay. */
  fullscreen?: boolean;
  /** Accessible status label; also shown to screen readers. */
  label?: string;
}

/**
 * An irregular zig-zag / wavy path across a 240x48 viewBox. `pathLength={1}`
 * normalises the geometry so a dasharray/offset of `1` cleanly draws the whole
 * stroke regardless of its real length.
 */
const ZIP_PATH =
  'M4 36 L28 14 L52 30 L74 10 L96 34 L120 18 L146 38 L170 12 L196 32 L220 16 L236 28';

export default function PawxisLoader({
  fullscreen = false,
  label = 'Loading…',
}: PawxisLoaderProps) {
  const containerClass = fullscreen
    ? 'fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-base-100'
    : 'flex flex-col items-center justify-center gap-5 p-10';

  return (
    <div className={containerClass} role="status" aria-label={label}>
      <div className="flex flex-col items-center gap-2">
        <Image
          src="/pawxis2.png"
          alt=""
          aria-hidden="true"
          width={56}
          height={56}
          priority
          className="h-14 w-14 object-contain"
        />
        <span className="text-sm font-semibold tracking-wide text-base-content">
          Pawxis
        </span>
      </div>

      <svg
        className="pawxis-zip w-48 text-primary"
        viewBox="0 0 240 48"
        fill="none"
        aria-hidden="true"
      >
        <path
          d={ZIP_PATH}
          pathLength={1}
          className="stroke-primary"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <span className="sr-only">{label}</span>

      <style jsx global>{`
        @keyframes pawxis-zip {
          from {
            stroke-dashoffset: var(--len);
          }
          to {
            stroke-dashoffset: 0;
          }
        }

        .pawxis-zip path {
          --len: 1;
          stroke-dasharray: 1;
          stroke-dashoffset: 0;
          animation: pawxis-zip 1.4s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .pawxis-zip path {
            animation: none;
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </div>
  );
}
