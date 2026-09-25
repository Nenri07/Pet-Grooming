import type { MetadataRoute } from 'next';

/**
 * robots.txt for PawPort.
 *
 * Allow all crawling of the public marketing surface, but DISALLOW:
 *   - `/demo/`   personalized prospect demos are noindex per spec
 *   - portal/auth/app routes that require a session or hold private data
 *
 * The sitemap points at NEXT_PUBLIC_APP_URL/sitemap.xml.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    ''
  );

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/demo/',
        '/dashboard',
        '/login',
        '/register',
        '/onboarding',
        '/settings',
        '/billing',
        '/inbox',
        '/calendar',
        '/appointments',
        '/clients',
        '/services',
        '/availability',
        '/analytics',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
