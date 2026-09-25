import type { Metadata } from 'next';
import {
  Hero,
  ProblemStrip,
  HowItWorks,
  OrderRadarShowcase,
  BentoFeatures,
  FillMyDayEta,
  PetCardShowcase,
  ReceiptShowcase,
  StatsMarquee,
  Testimonial,
  Comparison,
  PricingCTA,
  Faq,
  FinalCTA,
} from '@/components/marketing';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  faqPageJsonLd,
  jsonLdString,
  organizationJsonLd,
  softwareApplicationJsonLd,
} from '@/lib/seo/jsonld';

/**
 * Landing-specific SEO. This page stays a SERVER component (no 'use client'),
 * so it can export route metadata and server-render JSON-LD, while still
 * composing the client-side animated sections below.
 */
export const metadata: Metadata = {
  title: 'Mobile pet grooming booking software',
  description:
    'PawPort is booking, routing and no-show protection software for solo mobile pet groomers. Take route-aware bookings, collect deposits, and cut no-shows. Groom more dogs. Drive less.',
  alternates: { canonical: absoluteUrl('/') },
  openGraph: {
    title: 'PawPort — Mobile pet grooming booking software',
    description:
      'Route-aware booking, deposits and no-show protection built for solo mobile pet groomers.',
    url: absoluteUrl('/'),
    type: 'website',
  },
};

/**
 * PawPort marketing landing page (Section 7). Composed in a sensible order:
 *   1. Hero (the single <h1>)
 *   2. ProblemStrip
 *   3. HowItWorks (3-step stepper)
 *   4. OrderRadarShowcase (#order-radar — the centrepiece)
 *   5. BentoFeatures (#features)
 *   6. FillMyDayEta
 *   7. PetCardShowcase (flip card + before/after)
 *   8. ReceiptShowcase (branded receipt download)
 *   9. StatsMarquee (services marquee + founding fallback)
 *   10. Testimonial (data-driven; renders null while empty)
 *   11. Comparison
 *   12. PricingCTA (#pricing)
 *   13. Faq
 *   14. FinalCTA
 *
 * URL stays "/" via the (public) route group; the shared header/footer come
 * from the group layout. JSON-LD structured data (Organization +
 * SoftwareApplication + FAQPage + BreadcrumbList) is server-rendered from
 * trusted in-repo content.
 */
export default function Home() {
  const jsonLd = jsonLdString(
    organizationJsonLd(),
    softwareApplicationJsonLd(),
    faqPageJsonLd(),
    breadcrumbJsonLd([{ name: 'Home', path: '/' }])
  );

  return (
    <>
      <script
        type="application/ld+json"
        // Trusted, in-repo content only — safe to inject.
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <Hero />
      <ProblemStrip />
      <HowItWorks />
      <OrderRadarShowcase />
      <BentoFeatures />
      <FillMyDayEta />
      <PetCardShowcase />
      <ReceiptShowcase />
      <StatsMarquee />
      <Testimonial />
      <Comparison />
      <PricingCTA />
      <Faq />
      <FinalCTA />
    </>
  );
}
