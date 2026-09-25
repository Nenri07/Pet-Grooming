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
 * `/for-groomers` — the bundle pitch page ("your own branded website + the
 * booking system behind it") for prospective solo mobile pet groomers.
 *
 * This stays a SERVER component (no 'use client') so it can export route
 * metadata and server-render JSON-LD, while composing the client-side animated
 * sections below (each section owns its own motion). The shared
 * header/footer + MotionProvider come from the (public) group layout.
 */

export const metadata: Metadata = {
  title: 'Get your own pet grooming website + booking system · PawPort',
  description:
    'PawPort bundles a branded website for mobile pet groomers with online booking, deposits, route-aware scheduling, two-way SMS and digital pet records — one subscription, set up in an afternoon. Start free.',
  keywords: [
    'pet grooming website',
    'mobile pet groomer booking system',
    'dog grooming booking software',
    'groomer website builder',
    'online booking for groomers',
    'mobile grooming software',
  ],
  alternates: { canonical: absoluteUrl('/for-groomers') },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Your own pet grooming website + booking system · PawPort',
    description:
      'A branded website plus booking, deposits, routing, SMS and pet records for solo mobile groomers — in one bundle.',
    url: absoluteUrl('/for-groomers'),
    type: 'website',
    images: [{ url: absoluteUrl('/og.jpg'), width: 1200, height: 630, alt: 'PawPort' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Your own pet grooming website + booking system · PawPort',
    description:
      'A branded website plus booking, deposits, routing, SMS and pet records for solo mobile groomers — in one bundle.',
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
