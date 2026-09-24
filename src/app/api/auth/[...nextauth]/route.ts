/**
 * NextAuth.js App Router handler.
 *
 * Mounts the catch-all auth endpoints (sign-in, callback, session, csrf, etc.)
 * for both GET and POST using the shared `authOptions`.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.6_
 */
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth/config';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
