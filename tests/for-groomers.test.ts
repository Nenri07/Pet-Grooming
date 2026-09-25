import { describe, expect, it } from 'vitest';
import { forGroomers } from '@/content/for-groomers';
import { bundleProductJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { PLANS } from '@/lib/plans';

/**
 * Unit tests for the `/for-groomers` bundle page's data + SEO helpers. These
 * are pure (no DOM): they guard the honest-content invariants and confirm the
 * Product JSON-LD uses the REAL plan prices from the catalog.
 */

describe('for-groomers content', () => {
  it('drives both CTAs to /register and the demo, and keeps a single headline', () => {
    expect(forGroomers.hero.primaryCta.href).toBe('/register');
    expect(forGroomers.hero.secondaryCta.href).toBe('/demo/happy-paws');
    expect(forGroomers.finalCta.primaryCta.href).toBe('/register');
    expect(forGroomers.pricing.cta.href).toBe('/register');
    expect(forGroomers.hero.headline.length).toBeGreaterThan(0);
  });

  it('lists all seven bundle items with copy + icons', () => {
    expect(forGroomers.whatYouGet.items).toHaveLength(7);
    for (const item of forGroomers.whatYouGet.items) {
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.description.trim().length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });

  it('frames the bundle value honestly (no invented competitor prices)', () => {
    const value = forGroomers.bundleValue;
    expect(value.replaces.length).toBeGreaterThanOrEqual(3);
    const blob = JSON.stringify(value).toLowerCase();
    // Honest framing must not fabricate rival prices.
    expect(blob).not.toMatch(/\$\d/);
    expect(blob).toContain('separate');
  });

  it('provides 4-5 bundle-specific FAQ entries', () => {
    expect(forGroomers.faq.length).toBeGreaterThanOrEqual(4);
    expect(forGroomers.faq.length).toBeLessThanOrEqual(5);
    for (const item of forGroomers.faq) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('for-groomers JSON-LD', () => {
  it('builds a Product schema with the real Solo/Pro prices and no ratings', () => {
    const product = bundleProductJsonLd() as Record<string, unknown>;
    expect(product['@type']).toBe('Product');
    expect(product).not.toHaveProperty('aggregateRating');

    const offers = product.offers as {
      lowPrice: number;
      highPrice: number;
      priceCurrency: string;
      offers: { name: string; price: number }[];
    };
    expect(offers.priceCurrency).toBe('USD');
    expect(offers.lowPrice).toBe(Math.min(PLANS.solo.priceMonth, PLANS.pro.priceMonth));
    expect(offers.highPrice).toBe(Math.max(PLANS.solo.priceMonth, PLANS.pro.priceMonth));

    const byName = Object.fromEntries(offers.offers.map((o) => [o.name, o.price]));
    expect(byName.Solo).toBe(PLANS.solo.priceMonth);
    expect(byName.Pro).toBe(PLANS.pro.priceMonth);
  });

  it('builds a FAQPage from the bundle FAQ items', () => {
    const faq = faqPageJsonLd(forGroomers.faq) as {
      '@type': string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity).toHaveLength(forGroomers.faq.length);
    expect(faq.mainEntity[0].name).toBe(forGroomers.faq[0].question);
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe(forGroomers.faq[0].answer);
  });
});
