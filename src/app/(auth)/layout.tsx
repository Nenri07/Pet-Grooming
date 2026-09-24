import * as React from 'react';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';

/**
 * (auth) route group layout.
 *
 * Renders a centered, premium card layout shared by the login and register
 * pages. Vertically and horizontally centers a single Card on a full-height,
 * base-200 canvas so the auth forms feel focused and branded, matching the
 * PawPort aesthetic (rounded-2xl, soft shadow).
 *
 * _Requirements: 19.1, 19.2_
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-base-200 py-10">
      <Container size="sm" className="flex flex-col items-center">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-2xl font-bold text-primary"
        >
          PawPort
        </Link>
        <Card className="w-full max-w-md">{children}</Card>
      </Container>
    </main>
  );
}
