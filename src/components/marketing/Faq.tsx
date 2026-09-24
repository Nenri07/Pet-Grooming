'use client';
import * as React from 'react';
import { Reveal } from '@/components/motion';
import { SectionHeading } from './SectionHeading';
import { landing } from '@/content/landing';

/**
 * FAQ (Section 7.11) — an accordion built on daisyUI's `collapse` with native
 * <details>/<summary>, so it works with JS off and is keyboard-accessible for
 * free. Each item's summary is a 44px+ touch target.
 */
export function Faq() {
  return (
    <section aria-labelledby="faq-heading" className="bg-base-200">
      <div className="mx-auto max-w-3xl px-gutter py-section">
        <SectionHeading eyebrow="Questions" title="Frequently asked" />

        <Reveal className="mt-12 space-y-4">
          {landing.faq.map((item, i) => (
            <details
              key={item.question}
              className="collapse collapse-arrow rounded-box border border-base-content/10 bg-base-100"
              {...(i === 0 ? { open: true } : {})}
            >
              <summary className="collapse-title flex min-h-[44px] items-center font-display text-lg font-semibold text-base-content">
                {item.question}
              </summary>
              <div className="collapse-content">
                <p className="text-base-content/70">{item.answer}</p>
              </div>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export default Faq;
