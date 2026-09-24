/**
 * NextAuth.js module augmentation for PawPort.
 *
 * Extends the default `Session` and `JWT` shapes so the extra fields we set in
 * the auth callbacks (`src/lib/auth/config.ts`) are strongly typed at every
 * call site (`useSession`, `getServerSession`, middleware token, etc.).
 *
 * _Requirements: 1.1, 1.2, 1.6_
 */
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  /** The session object returned to the client and server. */
  interface Session {
    user: {
      /** MongoDB User `_id` as a string. */
      id: string;
      /** Whether the groomer has finished the onboarding wizard. */
      onboardingComplete: boolean;
      /** The groomer's public booking slug, or null if not yet set. */
      groomerSlug: string | null;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  /** The decoded JWT stored in the session cookie. */
  interface JWT {
    /** MongoDB User `_id`, copied from the authorized user at sign-in. */
    userId?: string;
    /**
     * Whether the groomer has finished the onboarding wizard. Stamped onto the
     * token by the jwt callback so middleware can gate portal routes without a
     * per-request DB call.
     */
    onboardingComplete?: boolean;
    /** The groomer's public booking slug, or null if not yet set. */
    groomerSlug?: string | null;
  }
}
