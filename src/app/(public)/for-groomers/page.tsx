import type { Metadata } from 'next';
import {
  BundleHero,
  WhatYouGet,
  BundleValue,
  BundlePricing,
  BundleFaq,
  BundleFinalCta,
} from '@/components/for-groomers';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  bundleProductJsonLd,
  faqPageJsonLd,
  jsonLdString,
} from '@/lib/seo/jsonld';
import { forGroomers } from '@/content/for-groomers';

/**
 * `/for-groomers` — the bundle pitch page ("your own booking page + the tools
 * that run your day") for prospective solo mobile pet groomers.
 *
 * This stays a SERVER component (no 'use client') so it can export route
 * metadata and server-render JSON-LD, while composing the client-side animated
 * sections below (each section owns its own motion). The shared
 * header/footer + MotionProvider come from the (public) group layout.
 */

export const metadata: Metadata = {
  // The root layout adds " · Pawxis" to this title, so it is left out here.
  title: 'Booking page + scheduling for mobile pet groomers',
  description:
    'Pawxis gives mobile pet groomers a booking page with your name and logo, plus deposits, route-aware scheduling, email reminders, client messaging and digital pet records. One subscription. Start free.',
  keywords: [
    'mobile pet groomer booking system',
    'dog grooming booking software',
    'booking page for groomers',
    'online booking for groomers',
    'mobile grooming software',
    'mobile grooming scheduling',
  ],
  alternates: { canonical: absoluteUrl('/for-groomers') },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Your own booking page + the tools that run your day · Pawxis',
    description:
      'A booking page with your name and logo, plus deposits, routing, client messaging and pet records for solo mobile groomers, in one bundle.',
    url: absoluteUrl('/for-groomers'),
    type: 'website',
    images: [{ url: absoluteUrl('/og.jpg'), width: 1200, height: 630, alt: 'Pawxis' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Your own booking page + the tools that run your day · Pawxis',
    description:
      'A booking page with your name and logo, plus deposits, routing, client messaging and pet records for solo mobile groomers, in one bundle.',
    images: [absoluteUrl('/og.jpg')],
  },
};

export default function ForGroomersPage() {
  const jsonLd = jsonLdString(
    bundleProductJsonLd(),
    faqPageJsonLd(forGroomers.faq),
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'For groomers', path: '/for-groomers' },
    ])
  );

  return (
    <>
      <script
        type="application/ld+json"
        // Trusted, in-repo content only — safe to inject.
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <BundleHero />
      <WhatYouGet />
      <BundleValue />
      <BundlePricing />
      <BundleFaq />
      <BundleFinalCta />
    </>
  );
}
