'use client';
import * as React from 'react';
import { motion, useInView } from 'framer-motion';
import { NumberTicker } from '@/components/motion';
import { useGsapContext, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { landing } from '@/content/landing';

/**
 * ReceiptShowcase — animates the branded booking-receipt "download" experience.
 *
 * Motion ownership:
 *   - Framer (useInView + motion) owns the ticket slide/scale-in and the
 *     download button's tap micro-interaction on their own nodes.
 *   - NumberTicker (Framer) owns the deposit amount count-up (SSR-safe: the
 *     final value is in server HTML).
 *   - GSAP owns a subtle continuous float on a DEDICATED wrapper node, distinct
 *     from the Framer entrance node, so the two never write the same transform.
 *
 * Reduced motion: the ticket renders in its final state, no float, no count-up
 * (NumberTicker shows the final value), and the button has no motion.
 */
export function ReceiptShowcase() {
  const reduced = useReducedMotion();
  const { receipt } = landing;
  const { sample } = receipt;

  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4, once: true });

  // GSAP continuous float on a dedicated wrapper (not the Framer entrance node).
  const floatRef = useGsapContext(({ gsap, reduced: r, scope }) => {
    if (r) return;
    const layer = scope.querySelector<HTMLElement>('[data-float-layer]');
    if (!layer) return;
    gsap.to(layer, {
      y: -10,
      duration: 2.6,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });
  });

  const hidden = reduced
    ? { opacity: 1, y: 0, scale: 1 }
    : { opacity: 0, y: 40, scale: 0.94 };
  const shown = { opacity: 1, y: 0, scale: 1 };

  return (
    <section
      aria-labelledby="receipt-heading"
      className="bg-base-200"
      ref={floatRef as React.RefObject<HTMLDivElement>}
    >
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          titleId="receipt-heading"
          eyebrow={receipt.eyebrow}
          title={receipt.title}
          subtitle={receipt.subtitle}
        />

        <div className="mt-14 grid items-center gap-12 lg:grid-cols-2">
          {/* ---- Copy ---- */}
          <div className="order-2 max-w-lg lg:order-1">
            <p className="text-lg text-base-content/70">
              Every booking gets a branded receipt clients can download and show
              on arrival. No screenshots of a text thread, no confusion at the
              door — just a clean slip with the reference, time and deposit.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Unique reference on every booking',
                'Deposit clearly marked as paid',
                'Downloads in one tap, works offline',
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 text-base-content"
                >
                  <span
                    aria-hidden
                    className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                  >
                    ✓
                  </span>
                  <span className="text-base-content/80">{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ---- Receipt ticket mockup ---- */}
          <div
            className="order-1 flex justify-center lg:order-2"
            data-float-layer
          >
            <motion.div
              ref={ref}
              initial={hidden}
              animate={inView ? shown : hidden}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-sm overflow-hidden rounded-box border border-base-content/10 bg-base-100 shadow-card"
            >
              {/* Header: primary→accent gradient */}
              <div className="bg-gradient-to-r from-primary to-accent px-6 py-5 text-primary-content">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-90">
                  Booking receipt
                </p>
                <p className="mt-1 font-display text-xl font-bold">PawPort</p>
              </div>

              {/* Body */}
              <div className="space-y-5 px-6 py-6">
                {/* Big boxed reference */}
                <div className="rounded-2xl border border-dashed border-base-content/20 bg-base-200 px-4 py-3 text-center">
                  <p className="text-[0.7rem] uppercase tracking-wide text-base-content/50">
                    Reference
                  </p>
                  <p className="mt-1 font-display text-2xl font-bold tracking-widest text-base-content">
                    {sample.reference}
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-base-content/50">Date</dt>
                    <dd className="font-medium text-base-content">
                      {sample.date}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/50">Time</dt>
                    <dd className="font-medium text-base-content">
                      {sample.time}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/50">Pet</dt>
                    <dd className="font-medium text-base-content">
                      {sample.pet}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/50">Service</dt>
                    <dd className="font-medium text-base-content">
                      {sample.service}
                    </dd>
                  </div>
                </dl>

                <div className="flex items-center justify-between border-t border-base-content/10 pt-4">
                  <div>
                    <p className="text-base-content/50">Deposit</p>
                    <p className="font-display text-2xl font-bold text-base-content">
                      <NumberTicker
                        value={sample.amount}
                        prefix={sample.currency}
                      />
                    </p>
                  </div>
                  <span className="rounded-badge bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    {sample.depositLabel}
                  </span>
                </div>

                {/* Download button micro-interaction */}
                <motion.button
                  type="button"
                  whileHover={reduced ? undefined : { scale: 1.03 }}
                  whileTap={reduced ? undefined : { scale: 0.97 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="btn btn-primary min-h-[44px] w-full gap-2"
                >
                  <span aria-hidden>⭳</span>
                  {receipt.downloadLabel}
                </motion.button>

                <p className="text-center text-[0.7rem] text-base-content/50">
                  Illustrative example
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ReceiptShowcase;
