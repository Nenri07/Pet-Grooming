'use client';
import * as React from 'react';
import { Check, X } from 'lucide-react';
import { Reveal } from '@/components/motion';
import { SectionHeading } from './SectionHeading';
import { landing } from '@/content/landing';

/**
 * Comparison (Section 7.9) — PawPort vs a generic "typical grooming software"
 * column. Competitors are NEVER named and claims stay defensible/generic.
 *
 * Cell values are either a boolean (rendered as a success check / muted cross
 * using theme tokens) or a short string. The table scrolls horizontally inside
 * its own container on small screens so the page never overflows at 320px.
 */

function Cell({ value, emphasise }: { value: boolean | string; emphasise?: boolean }) {
  if (typeof value === 'boolean') {
    return value ? (
      <span className="inline-flex items-center justify-center">
        <Check className="h-5 w-5 text-success" aria-label="Included" />
      </span>
    ) : (
      <span className="inline-flex items-center justify-center">
        <X className="h-5 w-5 text-base-content/30" aria-label="Not included" />
      </span>
    );
  }
  return (
    <span
      className={
        emphasise
          ? 'font-semibold text-primary'
          : 'text-base-content/70'
      }
    >
      {value}
    </span>
  );
}

export function Comparison() {
  const { comparison } = landing;

  return (
    <section aria-labelledby="comparison-heading" className="bg-base-200">
      <div className="mx-auto max-w-5xl px-gutter py-section">
        <SectionHeading
          eyebrow="How we compare"
          title="Built for the road, not the salon"
          subtitle="Most grooming tools were made for a fixed shop. PawPort is made for a single van on the move."
        />

        <Reveal className="mt-14">
          <div className="overflow-x-auto rounded-box border border-base-content/10 bg-base-100 shadow-card">
            <table className="w-full min-w-[30rem] border-collapse text-left">
              <caption className="sr-only" id="comparison-heading">
                PawPort compared with typical grooming software
              </caption>
              <thead>
                <tr className="border-b border-base-content/10">
                  <th scope="col" className="p-4 text-sm font-medium text-base-content/60">
                    Capability
                  </th>
                  <th scope="col" className="p-4 text-center font-display text-base font-bold text-primary">
                    PawPort
                  </th>
                  <th scope="col" className="p-4 text-center text-sm font-medium text-base-content/60">
                    {comparison.otherLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-base-content/10 last:border-0"
                  >
                    <th
                      scope="row"
                      className="p-4 text-sm font-medium text-base-content"
                    >
                      {row.label}
                    </th>
                    <td className="p-4 text-center text-sm">
                      <Cell value={row.pawport} emphasise />
                    </td>
                    <td className="p-4 text-center text-sm">
                      <Cell value={row.typical} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default Comparison;
