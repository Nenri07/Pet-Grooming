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
const metadataBase = new URL(
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
);

export const metadata: Metadata = {
  metadataBase,
  title: 'PawPort',
  description,
  openGraph: {
    title: 'PawPort — Groom more dogs. Drive less.',
    description,
    type: 'website',
    images: [{ url: '/og.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PawPort — Groom more dogs. Drive less.',
    description,
    images: ['/og.jpg'],
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
