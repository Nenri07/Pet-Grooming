'use client';
import * as React from 'react';
import { Reveal } from '@/components/motion';
import { SectionHeading } from '@/components/marketing/SectionHeading';
import { forGroomers } from '@/content/for-groomers';

/**
 * BundleFaq — accordion built on daisyUI's `collapse` with native
 * <details>/<summary>, so it works with JS off and is keyboard-accessible for
 * free (mirrors the landing Faq). Each summary is a 44px+ touch target.
 */
export function BundleFaq() {
  return (
    <section id="faq" aria-labelledby="for-groomers-faq-heading" className="bg-base-200">
      <div className="mx-auto max-w-3xl px-gutter py-section">
        <SectionHeading
          eyebrow="Questions"
          title="Bundle questions, answered"
          titleId="for-groomers-faq-heading"
        />

        <Reveal className="mt-12 space-y-4">
          {forGroomers.faq.map((item, i) => (
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

export default BundleFaq;
