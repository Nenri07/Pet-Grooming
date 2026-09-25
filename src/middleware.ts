/**
 * PawPort route-protection middleware.
 *
 * Runs on every page request (see `config.matcher`) and enforces:
 *
 *  1. Unauthenticated users are redirected away from the private Groomer_Portal
 *     routes to `/login` (Requirement 1.5).
 *  2. Authenticated users who hit an auth page (`/login`, `/register`) are
 *     redirected to their proper destination (dashboard, or the onboarding
 *     wizard if incomplete) — you can't sit on the login page while signed in.
 *  3. Authenticated groomers whose onboarding is incomplete are redirected to
 *     `/onboarding`, except when already there or on an auth page.
 *
 * Public routes (marketing home, public booking, shared pet cards, demo pages,
 * claim/rebook/track token pages, credits) are allowed through without a
 * session. The `onboardingComplete` / `groomerSlug` flags are read straight off
 * the JWT (stamped by the jwt callback in `src/lib/auth/config.ts`), so no DB
 * call happens here.
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
  '/analytics',
  '/settings',
  '/calendar',
  '/inbox',
  '/billing',
] as const;

/** The auth pages a signed-in user should be redirected AWAY from. */
const AUTH_ROUTES = ['/login', '/register'] as const;

/** True when `pathname` is (or is nested under) one of the portal routes. */
function isPortalRoute(pathname: string): boolean {
  return PORTAL_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/** True when `pathname` is one of the auth pages. */
function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/** True when `pathname` is (or is nested under) the onboarding wizard. */
function isOnboardingRoute(pathname: string): boolean {
  return pathname === '/onboarding' || pathname.startsWith('/onboarding/');
}

/**
 * Pure redirect-resolution for the middleware.
 *
 * Returns the absolute path to redirect to, or `null` to let the request
 * through. Kept free of `NextResponse`/request objects so it can be unit-tested
 * directly and reasoned about in isolation.
 *
 * A hard invariant guards against the blank-page / redirect loop that trapped
 * Google sign-ins: this NEVER returns a path equal to the current one, so a
 * request can never be redirected to itself (e.g. /onboarding -> /onboarding or
 * /login -> /login). `onboardingComplete` is treated as false when undefined,
 * so a not-yet-loaded flag sends the user to onboarding rather than looping.
 */
export function resolveRedirect(params: {
  pathname: string;
  isAuthenticated: boolean;
  onboardingComplete: boolean | undefined;
}): string | null {
  const { pathname, isAuthenticated } = params;
  // Undefined onboarding status is treated as incomplete (defensive default).
  const onboardingComplete = params.onboardingComplete === true;

  // Unauthenticated on a portal route -> login.
  if (!isAuthenticated && isPortalRoute(pathname)) {
    return pathname === '/login' ? null : '/login';
  }

  // Signed-in users must NOT sit on the login/register pages. Send them to
  // onboarding when incomplete, otherwise the dashboard.
  if (isAuthenticated && isAuthRoute(pathname)) {
    const dest = onboardingComplete ? '/dashboard' : '/onboarding';
    // Loop-guard: never redirect a path to itself.
    return pathname === dest ? null : dest;
  }

  // Signed-in groomers with incomplete onboarding -> the wizard, unless they
  // are already on it. The explicit onboarding-route check makes the
  // no-self-redirect guarantee obvious even as the route set evolves.
  if (isAuthenticated && !onboardingComplete && !isOnboardingRoute(pathname)) {
    return '/onboarding';
  }

  return null;
}

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    const dest = resolveRedirect({
      pathname,
      isAuthenticated: !!token,
      onboardingComplete: token?.onboardingComplete,
    });

    if (dest) {
      return NextResponse.redirect(new URL(dest, req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      /**
       * Gate for whether the request reaches the middleware above. `true` lets
       * it through; `false` triggers NextAuth's redirect to `/login`.
       */
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;

        // Auth pages are reachable without a session (the middleware function
        // above redirects signed-in users away from them).
        if (isAuthRoute(pathname)) return true;

        // The onboarding wizard requires a signed-in groomer.
        if (pathname.startsWith('/onboarding')) return !!token;

        // Portal routes require an authenticated session.
        if (isPortalRoute(pathname)) return !!token;

        // Everything else that reaches the matcher is public (marketing home,
        // /book, /pet-card, /demo, /claim, /rebook, /t, /credits, etc.).
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