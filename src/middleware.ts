/**
 * PawPort route-protection middleware.
 *
 * Runs on every request that isn't an API route or a Next.js internal asset
 * (see `config.matcher` below) and enforces two rules using the NextAuth JWT:
 *
 *  1. Unauthenticated users are redirected away from the private Groomer_Portal
 *     routes to `/login` (Requirement 1.5).
 *  2. Authenticated groomers whose onboarding is still incomplete are redirected
 *     to `/onboarding`, except when they're already on `/onboarding`.
 *
 * Public routes (marketing home, the public booking flow, shared pet cards, and
 * the auth pages) are always allowed through without a session. The
 * `onboardingComplete` / `groomerSlug` flags are read straight off the token —
 * they are stamped there by the jwt callback in `src/lib/auth/config.ts`, so no
 * database call happens here.
 *
 * _Requirements: 1.5_
 */
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

/**
 * Private Groomer_Portal route prefixes. A request whose path starts with any
 * of these requires an authenticated session; otherwise it is bounced to login.
 */
const PORTAL_ROUTES = [
  '/dashboard',
  '/clients',
  '/pets',
  '/appointments',
  '/services',
  '/availability',
  '/settings',
  '/analytics',
] as const;

/** True when `pathname` is (or is nested under) one of the portal routes. */
function isPortalRoute(pathname: string): boolean {
  return PORTAL_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Redirect unauthenticated users away from portal routes to /login.
    // (The `authorized` callback below also blocks these, but this keeps the
    // redirect target explicit for portal paths.)
    if (!token && isPortalRoute(pathname)) {
      const loginUrl = new URL('/login', req.url);
      return NextResponse.redirect(loginUrl);
    }

    // Redirect authenticated groomers with incomplete onboarding to the wizard,
    // unless they're already there.
    if (
      token &&
      !token.onboardingComplete &&
      !pathname.startsWith('/onboarding')
    ) {
      return NextResponse.redirect(new URL('/onboarding', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      /**
       * Decides whether the request is allowed to reach the middleware function
       * above. Returning `true` lets it through (public routes, or an
       * authenticated portal request); returning `false` triggers the NextAuth
       * redirect to the configured sign-in page (`/login`).
       */
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;

        // Public, always-allowed routes.
        if (pathname === '/') return true;
        if (
          pathname.startsWith('/book/') ||
          pathname.startsWith('/pet-card/')
        ) {
          return true;
        }
        if (
          pathname === '/login' ||
          pathname === '/register' ||
          pathname.startsWith('/login/') ||
          pathname.startsWith('/register/')
        ) {
          return true;
        }

        // The onboarding wizard is reachable by any signed-in groomer.
        if (pathname.startsWith('/onboarding')) return !!token;

        // Portal routes require an authenticated session.
        if (isPortalRoute(pathname)) return !!token;

        // Anything else that reached the matcher (e.g. other public pages) is
        // allowed without auth.
        return true;
      },
    },
  }
);

/**
 * Only run the middleware on page routes. API routes and Next.js internals
 * (static chunks, image optimizer, favicon) are excluded so they bypass auth.
 */
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
