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
import type { AccessClaim } from '@/lib/billing/access';

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
    /**
     * Compact billing access claim (status + trial deadline + pastDueSince as
     * epoch ms), stamped by the jwt callback so the Edge middleware can decide
     * the hard lockout via `accessFromClaim` without a per-request DB/Stripe
     * call. Absent when billing state has not yet been stamped (fail-open: the
     * middleware treats a missing claim as "allow").
     *
     * _Requirements: 3.1, 3.4_
     */
    access?: AccessClaim;
    /**
     * Epoch-ms timestamp of when {@link access} was last stamped by the jwt
     * callback. Drives the short time-based TTL (~5 min) so the access claim is
     * re-derived from the Subscription row periodically without a DB read on
     * every token refresh. Absent until the first stamp.
     *
     * _Requirements: 3.1, 3.4_
     */
    accessStampedAt?: number;
  }
}
