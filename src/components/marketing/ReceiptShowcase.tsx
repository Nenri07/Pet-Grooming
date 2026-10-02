'use client';
import * as React from 'react';
import { motion, useInView } from 'framer-motion';
import { Download, Printer } from 'lucide-react';
import { useGsapContext, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { landing } from '@/content/landing';
import { ReceiptTicket } from '@/components/booking/ReceiptTicket';
import type { ReceiptData } from '@/components/booking/ReceiptPDF';

/**
 * ReceiptShowcase — shows the REAL premium booking-receipt design on the
 * landing page by rendering the shared `<ReceiptTicket>` (the exact ticket
 * clients see on the booking success step) with sample data. Because the live
 * Download / Print buttons live in `BookingReceipt` (not the ticket), the
 * showcase renders the ticket on its own and adds a non-functional
 * "Download / Print" hint so prospects see — but can't trigger — the actions.
 *
 * Motion ownership:
 *   - Framer (useInView + motion) owns the ticket slide/scale-in on its node.
 *   - GSAP owns a subtle continuous float on a DEDICATED wrapper node, distinct
 *     from the Framer entrance node, so the two never write the same transform.
 *
 * Reduced motion: the ticket renders in its final state, no float, no entrance.
 */

/** Realistic sample receipt data — the exact shape the real ticket renders. */
const SAMPLE_RECEIPT: ReceiptData = {
  businessName: 'Happy Paws',
  logoUrl: '/pawxisLogo.png',
  bookingRef: 'PP-XK4T9M',
  petName: 'Bella',
  serviceName: 'Full groom',
  serviceAddress: '12 Oak Street, Austin',
  clientName: 'Jordan Lee',
  scheduledDate: '2025-07-17T14:30:00',
  depositAmount: 25,
  currency: 'usd',
};

export function ReceiptShowcase() {
  const reduced = useReducedMotion();
  const { receipt } = landing;

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

          {/* ---- The REAL receipt ticket (premium design, sample data) ---- */}
          <div
            className="order-1 flex flex-col items-center lg:order-2"
            data-float-layer
          >
            <motion.div
              ref={ref}
              initial={hidden}
              animate={inView ? shown : hidden}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-sm"
            >
              {/* Distinct id so it never collides with a live #pp-receipt. */}
              <ReceiptTicket data={SAMPLE_RECEIPT} id="pp-receipt-showcase" />

              {/* Non-functional action hint — mirrors the real buttons. */}
              <div
                aria-hidden="true"
                className="mt-4 flex flex-col gap-3 sm:flex-row"
              >
                <span className="btn btn-primary pointer-events-none min-h-[44px] flex-1 gap-2 opacity-60">
                  <Download className="h-4 w-4" />
                  {receipt.downloadLabel}
                </span>
                <span className="btn btn-outline pointer-events-none min-h-[44px] gap-2 opacity-60 sm:flex-none">
                  <Printer className="h-4 w-4" />
                  Print
                </span>
              </div>

              <p className="mt-3 text-center text-[0.7rem] text-base-content/50">
                Illustrative example
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ReceiptShowcase;
