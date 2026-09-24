'use client';

import type { ReactNode } from 'react';
import type { Session } from 'next-auth';
import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

/**
 * SessionProvider — client wrapper for the NextAuth session context.
 *
 * Wraps the app in next-auth's `SessionProvider` so client components can call
 * `useSession()`. The optional `session` prop lets a server layout hydrate the
 * initial session to avoid a client-side fetch on first paint.
 *
 * _Requirements: 1.2, 1.6_
 */
interface SessionProviderProps {
  children: ReactNode;
  session?: Session | null;
}

export function SessionProvider({ children, session }: SessionProviderProps) {
  return (
    <NextAuthSessionProvider session={session}>
      {children}
    </NextAuthSessionProvider>
  );
}
