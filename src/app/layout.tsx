import type { Metadata } from 'next';
import './globals.css';
import { fontVars } from '@/styles/fonts';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { AnimationProvider } from '@/lib/animation';

const description =
  'The booking, routing and no-show shield built for solo mobile pet groomers. Groom more dogs. Drive less.';

// Base URL for resolving relative OG/Twitter image paths (fixes the Next.js
// build warning about metadataBase being unset). Uses the public app URL when
// configured, else a sane localhost default for dev/build.
//
// Resilient parse: a protocol-less value (e.g. "pawxis.app") makes `new URL()`
// throw ERR_INVALID_URL, which previously crashed the whole build at metadata
// collection. We prepend https:// when the scheme is missing and fall back to
// localhost if the value is still unparseable, so a misconfigured env var can
// never break the build.
function resolveMetadataBase(): URL {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const fallback = new URL('http://localhost:3000');
  if (!raw) return fallback;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate);
  } catch {
    return fallback;
  }
}

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: 'Pawxis — Mobile pet grooming booking software',
    template: '%s · Pawxis',
  },
  description,
  keywords: [
    'mobile pet grooming booking software',
    'mobile dog groomer software',
    'pet grooming scheduling',
    'route optimization for groomers',
    'no-show protection',
    'grooming deposits',
    'booking page for groomers',
    'solo mobile groomer',
  ],
  applicationName: 'Pawxis',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Pawxis — Groom more dogs. Drive less.',
    description,
    type: 'website',
    siteName: 'Pawxis',
    url: '/',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Pawxis' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pawxis — Groom more dogs. Drive less.',
    description,
    images: ['/og.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={fontVars}>
      <body className="bg-base-100 text-base-content antialiased">
        <SessionProvider>
          <ThemeProvider>
            <AnimationProvider>
              {children}
              <ToastProvider />
            </AnimationProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
