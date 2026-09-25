import type { MetadataRoute } from 'next';
import { demos } from '@/content/demos';

/**
 * XML sitemap for the public, indexable surface of PawPort.
 *
 * Absolute URLs are built from NEXT_PUBLIC_APP_URL (with a localhost fallback
 * so dev/build never emit malformed URLs). We list the marketing routes that
 * should be indexed:
 *   - `/`             the landing page
 *   - `/for-groomers` the bundle page (built in a separate task; referenced now)
 *   - `/credits`      image credits
 *   - `/demo/{slug}`  personalized prospect demos
 *
 * Note: demo pages are noindex per spec and are also disallowed in robots.ts;
 * they are included here only so the demo URLs are discoverable to us when
 * pitching. Portal/auth routes are intentionally omitted.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    ''
  );
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    {
      url: `${base}/for-groomers`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${base}/credits`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  const demoRoutes: MetadataRoute.Sitemap = demos.map((d) => ({
    url: `${base}/demo/${d.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.4,
  }));

  return [...staticRoutes, ...demoRoutes];
}
