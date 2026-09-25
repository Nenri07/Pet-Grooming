/**
 * JSON-LD structured-data helpers (SEO).
 *
 * These build plain JSON-LD objects from TRUSTED, in-repo content (landing copy
 * + env config) so they can be server-rendered into a
 * <script type="application/ld+json"> on the landing page. Nothing here comes
 * from user input, so it is safe to serialize directly.
 *
 * Consumers should stringify with {@link jsonLdString} and inject via
 * dangerouslySetInnerHTML on a <script> tag.
 */

import { landing, type FaqItem } from '@/content/landing';

/** Absolute site base URL, from env with a sane localhost fallback. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return raw.replace(/\/$/, '');
}

/** Build an absolute URL for a site-relative path. */
export function absoluteUrl(path = '/'): string {
  const base = siteUrl();
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

/** Organization schema for PawPort. */
export function organizationJsonLd() {
  const url = siteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'PawPort',
    url,
    logo: absoluteUrl('/icon.svg'),
    description:
      'Booking, routing and no-show protection software for solo mobile pet groomers.',
    sameAs: [] as string[],
  } as const;
}

/**
 * SoftwareApplication schema — describes PawPort as a business SaaS app. Uses
 * the real starting price from the pricing content (no invented review counts).
 */
export function softwareApplicationJsonLd() {
  const url = siteUrl();
  const cheapest = [...landing.pricing.plans]
    .map((p) => p.monthly)
    .sort((a, b) => a - b)[0];

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'PawPort',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url,
    description:
      'Mobile pet grooming booking software with route-aware scheduling, deposits, two-way texting and no-show protection built for solo mobile groomers.',
    offers: {
      '@type': 'Offer',
      price: cheapest,
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: cheapest,
        priceCurrency: 'USD',
        unitText: 'MONTH',
      },
    },
  } as const;
}

/** FAQPage schema built from the landing FAQ content. */
export function faqPageJsonLd(items: FaqItem[] = landing.faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  } as const;
}

/** BreadcrumbList schema for a set of {name, path} crumbs. */
export function breadcrumbJsonLd(
  crumbs: { name: string; path: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  } as const;
}

/**
 * Combine several JSON-LD graphs into one array and stringify. Safe to inject
 * because every input originates from trusted in-repo content.
 */
export function jsonLdString(...graphs: object[]): string {
  return JSON.stringify(graphs.length === 1 ? graphs[0] : graphs);
}
