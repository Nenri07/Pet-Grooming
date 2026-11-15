'use client';

import * as React from 'react';
import { SectionHeading } from './SectionHeading';
import { landing } from '@/content/landing';

/**
 * HowItWorks: 3-step sequence on bg-base-200.
 * Copy comes from `landing.howItWorks` (single source of truth).
 */
export function HowItWorks() {
  const { eyebrow, title, subtitle, steps } = landing.howItWorks;

  return (
    <section aria-labelledby="how-heading" className="bg-base-200 py-band">
      <div className="mx-auto max-w-6xl px-6 md:px-10 lg:px-12">
        <SectionHeading eyebrow={eyebrow} title={title} subtitle={subtitle} titleId="how-heading" />

        <ol className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-base-300 bg-base-100 p-6">
              <span
                aria-hidden
                className="mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-content"
              >
                {i + 1}
              </span>
              <h3 className="font-display text-cardTitle font-semibold text-base-content">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-base-content/70">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default HowItWorks;
