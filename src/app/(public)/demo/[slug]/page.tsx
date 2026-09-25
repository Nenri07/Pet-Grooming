import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getDemo, demos } from '@/content/demos';
import { Reveal } from '@/components/motion';
import { DemoRadar } from '@/components/marketing/DemoRadar';

/**
 * Personalized prospect demo — `/demo/[slug]` (Master Spec §17).
 *
 * Renders a PREVIEW of the public booking experience personalized for a
 * prospect we are pitching: a branded header using the demo's business name
 * (and optional colour/logo), plus an INTERACTIVE Order Radar demo built on
 * FAKE sample stops scattered around the prospect's city. A prominent banner
 * invites them to claim the page for free, linking to `/register?claim={slug}`.
 *
 * This is a client-visual showcase only: it uses SAMPLE data from
 * `@/content/demos`, reads no database, writes nothing, places no real
 * bookings, and is `noindex` (see {@link generateMetadata}). If the slug does
 * not match a seeded demo it 404s.
 *
 * _Master Spec: §17_
 */

interface DemoPageProps {
  params: { slug: string };
}

/**
 * Pre-render the seeded demo slugs at build time. Unknown slugs still work
 * (they fall through to `notFound()` at request time) but the known prospects
 * become static.
 */
export function generateStaticParams(): { slug: string }[] {
  return demos.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: DemoPageProps): Promise<Metadata> {
  const demo = getDemo(params.slug);

  // Every demo page is noindex — prospect previews must never be crawled.
  const robots = { index: false, follow: false } as const;

  if (!demo) {
    return { title: 'Demo not found · PawPort', robots };
  }

  return {
    title: `${demo.businessName} · PawPort preview`,
    description: `A personalized PawPort booking preview built for ${demo.businessName} in ${demo.city}.`,
    robots,
  };
}

export default function DemoPage({ params }: DemoPageProps) {
  const demo = getDemo(params.slug);
  if (!demo) {
    notFound();
  }

  const claimHref = `/register?claim=${encodeURIComponent(demo.slug)}`;
  // The demo's accent colour is optional cosmetic branding, never a theme token.
  const accent = demo.color;

  return (
    <div className="bg-base-100">
      {/* Thin brand accent bar (uses the prospect's colour if provided). */}
      <div
        aria-hidden
        className="h-1 w-full bg-primary"
        style={accent ? { backgroundColor: accent } : undefined}
      />

      {/* ---- Claim banner (Master Spec §17) ---- */}
      <div className="border-b border-base-content/10 bg-base-200">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-3 px-gutter py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-base-content/80">
            This is a preview built for{' '}
            <span className="font-semibold text-base-content">{demo.businessName}</span>.
          </p>
          <Link
            href={claimHref}
            className="btn btn-primary btn-sm min-h-[44px] rounded-btn"
          >
            Claim it free →
          </Link>
        </div>
      </div>

      {/* ---- Branded header ---- */}
      <header className="mx-auto max-w-6xl px-gutter pb-8 pt-12 text-center sm:pt-16">
        <Reveal>
          <div className="flex flex-col items-center gap-4">
            {demo.logoUrl ? (
              <Image
                src={demo.logoUrl}
                alt={`${demo.businessName} logo`}
                width={72}
                height={72}
                className="h-18 w-18 rounded-box object-contain"
              />
            ) : (
              <span
                className="flex h-16 w-16 items-center justify-center rounded-box bg-primary text-2xl font-bold text-primary-content"
                style={accent ? { backgroundColor: accent } : undefined}
                aria-hidden
              >
                {demo.businessName.charAt(0)}
              </span>
            )}
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-accent">
              {demo.city}
            </p>
            <h1 className="font-display text-4xl font-bold text-base-content sm:text-5xl">
              {demo.businessName}
            </h1>
            <p className="max-w-xl text-lg text-base-content/70">
              Here is what your PawPort booking page could look like — branded to
              you, with route-smart scheduling built in.
            </p>
          </div>
        </Reveal>
      </header>

      {/* ---- Interactive Order Radar preview ---- */}
      <section
        aria-labelledby="demo-radar-heading"
        className="bg-base-200 py-section"
      >
        <div className="mx-auto max-w-6xl px-gutter">
          <h2 id="demo-radar-heading" className="sr-only">
            Order Radar preview for {demo.businessName}
          </h2>
          <Reveal>
            <DemoRadar demo={demo} />
          </Reveal>
        </div>
      </section>

      {/* ---- Booking preview mock (static, illustrative) ---- */}
      <section className="mx-auto max-w-6xl px-gutter py-section">
        <Reveal>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Pick a service',
                body: 'Your services and prices, shown exactly how you set them.',
              },
              {
                step: '2',
                title: 'Choose a time',
                body: 'Slots ranked by route fit so nearby bookings surface first.',
              },
              {
                step: '3',
                title: 'Confirm & pay deposit',
                body: 'Deposits and SMS confirmations cut no-shows automatically.',
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-box border border-base-content/10 bg-base-100 p-6 shadow-card"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-content"
                  style={accent ? { backgroundColor: accent } : undefined}
                >
                  {s.step}
                </span>
                <h3 className="mt-4 font-display text-xl font-bold text-base-content">
                  {s.title}
                </h3>
                <p className="mt-2 text-base-content/70">{s.body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ---- Final claim CTA ---- */}
      <section className="bg-base-200 py-section">
        <div className="mx-auto max-w-3xl px-gutter text-center">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-base-content sm:text-4xl">
              Make it yours, {demo.businessName}
            </h2>
            <p className="mt-4 text-lg text-base-content/70">
              This preview is free to claim. Set up your real booking page in a
              few minutes — no card required.
            </p>
            <Link
              href={claimHref}
              className="btn btn-primary mt-8 min-h-[44px] rounded-btn px-8"
            >
              Claim {demo.businessName} free →
            </Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
