'use client';
import * as React from 'react';
import Image from 'next/image';
import { Reveal, Parallax } from '@/components/motion';
import { SectionHeading } from './SectionHeading';
import { images } from '@/content/images.generated';

/**
 * FillMyDayEta (Section 7.5) — a split layout showing two phone mockups: a
 * waitlist SMS offer and a live ETA tracker, with a supporting photo behind
 * them on a parallax layer.
 *
 * Motion ownership (D4): GSAP owns the parallax on a DEDICATED wrapper around
 * the <Image> only. Framer owns the reveal on the phone mockups (separate
 * nodes). The two never touch the same node. Under reduced motion both are
 * static.
 */

/** A styled phone mockup wrapper. */
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[16rem] rounded-[2rem] border border-base-content/10 bg-base-100 p-3 shadow-card">
      <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-base-content/15" />
      <div className="space-y-3 rounded-[1.4rem] bg-base-200 p-4">{children}</div>
    </div>
  );
}

/** A chat bubble inside a phone mockup. */
function Bubble({
  children,
  from = 'them',
}: {
  children: React.ReactNode;
  from?: 'them' | 'you';
}) {
  const mine = from === 'you';
  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <p
        className={[
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug',
          mine
            ? 'bg-primary text-primary-content'
            : 'bg-base-100 text-base-content shadow-soft',
        ].join(' ')}
      >
        {children}
      </p>
    </div>
  );
}

export function FillMyDayEta() {
  return (
    <section aria-labelledby="fillmyday-heading" className="relative overflow-hidden bg-base-200">
      {/* Parallax supporting image on a dedicated wrapper (GSAP-owned). */}
      <Parallax speed={0.25} className="pointer-events-none absolute inset-0 -z-10">
        <div className="relative h-[120%] w-full opacity-20">
          <Image
            src={images.featureRoute.src}
            alt=""
            fill
            loading="lazy"
            sizes="100vw"
            placeholder="blur"
            blurDataURL={images.featureRoute.blurDataURL}
            className="object-cover"
          />
        </div>
      </Parallax>

      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          eyebrow="Never lose a slot"
          title="Fill cancellations and keep clients in the loop"
          subtitle="A drop-out doesn't have to mean a dead hour — and clients always know when you're on the way."
        />

        <div className="mt-14 grid items-center gap-12 md:grid-cols-2">
          {/* Fill My Day — waitlist offer */}
          <Reveal className="flex flex-col items-center gap-6 text-center">
            <Phone>
              <Bubble>
                A slot just opened Thu 2:30 — reply YES to grab it.
              </Bubble>
              <Bubble from="you">YES</Bubble>
              <Bubble>
                You&rsquo;re booked in. See you Thursday! 🐾
              </Bubble>
            </Phone>
            <div className="max-w-sm">
              <h3 className="font-display text-xl font-bold text-base-content">
                Fill My Day
              </h3>
              <p className="mt-2 text-base text-base-content/70">
                Cancelled slots go straight to nearby waitlisted clients. First
                to reply wins the spot.
              </p>
            </div>
          </Reveal>

          {/* Live ETA tracker */}
          <Reveal delay={0.1} className="flex flex-col items-center gap-6 text-center">
            <Phone>
              <div className="rounded-2xl bg-base-100 p-4 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  On the way
                </p>
                <p className="mt-2 font-display text-2xl font-bold text-base-content">
                  12 min away
                </p>
                <p className="mt-1 text-sm text-base-content/70">
                  Your groomer is heading to you now.
                </p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-base-300">
                  <div className="h-full w-2/3 rounded-full bg-primary" />
                </div>
              </div>
            </Phone>
            <div className="max-w-sm">
              <h3 className="font-display text-xl font-bold text-base-content">
                Live &ldquo;on the way&rdquo;
              </h3>
              <p className="mt-2 text-base text-base-content/70">
                Clients get a live tracking link, so no one is left wondering
                when the van will arrive.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default FillMyDayEta;
