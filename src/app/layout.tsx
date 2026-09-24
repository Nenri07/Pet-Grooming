import type { Metadata } from 'next';
import './globals.css';
import { fontVars } from '@/styles/fonts';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { AnimationProvider } from '@/lib/animation';

export const metadata: Metadata = {
  title: 'PawPort',
  description: 'Mobile-first booking and client management for solo mobile pet groomers.',
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
