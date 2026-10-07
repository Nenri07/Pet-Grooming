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
import { accessFromClaim, type AccessDecision } from '@/lib/billing/access';

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
  '/start-trial',
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
 * Verification routes that an authenticated-but-unverified user must always be
 * able to reach: the pending screen (which offers resend) and the link
 * confirmation page. These are NOT portal routes (they stay reachable while
 * unverified) and NOT auth routes (a signed-in user is not bounced off them).
 */
const VERIFY_PENDING_ROUTE = '/verify-pending';
const VERIFY_EMAIL_ROUTE = '/verify-email';

/** True when `pathname` is (or is nested under) a verification route. */
function isVerificationRoute(pathname: string): boolean {
  return pathname === VERIFY_PENDING_ROUTE || pathname.startsWith(`${VERIFY_PENDING_ROUTE}/`)
    || pathname === VERIFY_EMAIL_ROUTE || pathname.startsWith(`${VERIFY_EMAIL_ROUTE}/`);
}

// ---------------------------------------------------------------------------
// Coming-soon site takeover (pre-launch). When `COMING_SOON` is enabled, ALL
// public traffic is redirected to `/coming-soon`, EXCEPT: the coming-soon page
// itself, the waitlist action's own needs, and a few essentials. The team
// bypasses the takeover with `?preview=<COMING_SOON_BYPASS>`, which sets a
// cookie so the bypass sticks for the session. Flip `COMING_SOON` off to launch
// — no redeploy needed.
// ---------------------------------------------------------------------------

const COMING_SOON_ROUTE = '/coming-soon';
const COMING_SOON_COOKIE = 'pawxis_preview';

/** Whether the pre-launch takeover is switched on. */
function isComingSoonEnabled(): boolean {
  const v = process.env.COMING_SOON?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/**
 * Routes that must stay reachable even during the takeover: the coming-soon
 * page itself (so we don't loop) and the login route (so the team can still
 * sign in to use the bypassed app). Everything else is gated.
 */
function isComingSoonAllowed(pathname: string): boolean {
  // Static assets must NEVER be gated: the coming-soon page itself loads the
  // logo (/pawxisLogo.png), fonts, og image, etc. from /public. Redirecting
  // those to the HTML page is exactly why the logo rendered blank. Allow any
  // request that targets a file with an extension, plus Next internals.
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    /\.[a-zA-Z0-9]+$/.test(pathname) // has a file extension → static asset
  ) {
    return true;
  }
  return (
    pathname === COMING_SOON_ROUTE ||
    pathname.startsWith(`${COMING_SOON_ROUTE}/`) ||
    pathname === '/login' ||
    pathname.startsWith('/login/')
  );
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
 *
 * The optional `access` decision adds the Billing hard-lockout rule (Requirement
 * 3), applied LAST so the existing auth/onboarding behaviour is untouched: an
 * authenticated, onboarded groomer whose access is a lockout may only reach the
 * Upgrade_Page (`/billing` and nested) and the auth routes; any other portal
 * route redirects to `/billing`. When `access` is omitted (e.g. the billing
 * claim has not been stamped yet) the lockout rule is skipped entirely, so the
 * middleware fails OPEN and existing callers stay backward compatible.
 *
 * The `emailVerified` claim adds the email-verification gate (Requirement 2),
 * inserted AFTER the auth-route rule and BEFORE the onboarding rule: an
 * authenticated user whose email is not verified is routed to `/verify-pending`,
 * except when the request is already on a verification route (`/verify-pending`
 * or `/verify-email`), which must stay reachable so the user can verify. A
 * verified user is unaffected — the rule is a no-op — so existing routing is
 * byte-for-byte unchanged (R2.4, R5.2). `emailVerified` is treated as FALSE when
 * undefined (route to pending): the safe default, since the backfill + jwt
 * refresh give real users `true` quickly.
 *
 * _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.5, 3.6, 5.1, 5.2, 5.5_
 */
export function resolveRedirect(params: {
  pathname: string;
  isAuthenticated: boolean;
  onboardingComplete: boolean | undefined;
  /** Email-verification claim from the JWT; undefined is treated as FALSE (route to pending). */
  emailVerified: boolean | undefined;
  /** Billing access decision derived from the JWT claim; omit to skip lockout. */
  access?: AccessDecision;
}): string | null {
  const { pathname, isAuthenticated, access } = params;
  // Undefined onboarding status is treated as incomplete (defensive default).
  const onboardingComplete = params.onboardingComplete === true;
  // Undefined verification status is treated as unverified (safe default).
  const emailVerified = params.emailVerified === true;

  // Unauthenticated on a portal route -> login.
  if (!isAuthenticated && isPortalRoute(pathname)) {
    return pathname === '/login' ? null : '/login';
  }

  // Signed-in users must NOT sit on the login/register pages. An unverified
  // user is sent to the pending screen first (email verification gates ahead of
  // onboarding); otherwise onboarding when incomplete, else the dashboard.
  if (isAuthenticated && isAuthRoute(pathname)) {
    const dest = !emailVerified
      ? VERIFY_PENDING_ROUTE
      : onboardingComplete
        ? '/dashboard'
        : '/onboarding';
    // Loop-guard: never redirect a path to itself.
    return pathname === dest ? null : dest;
  }

  // Signed-in but email NOT verified -> the pending screen, unless the request
  // is already on a verification route (/verify-pending or /verify-email), which
  // must stay reachable so the user can verify. Runs AFTER the auth-route rule
  // and BEFORE the onboarding rule, so onboarding is gated behind verification.
  // For a verified user this is a no-op (routing unchanged). The verification-
  // route check preserves the no-self-redirect invariant.
  if (isAuthenticated && !emailVerified && !isVerificationRoute(pathname)) {
    return VERIFY_PENDING_ROUTE;
  }

  // Signed-in groomers with incomplete onboarding -> the wizard, unless they
  // are already on it. The explicit onboarding-route check makes the
  // no-self-redirect guarantee obvious even as the route set evolves.
  if (isAuthenticated && !onboardingComplete && !isOnboardingRoute(pathname) && !isVerificationRoute(pathname)) {
    return '/onboarding';
  }

  // Hard lockout (R3): an authenticated, onboarded groomer whose access has
  // been resolved to a lockout may only reach the Upgrade_Page (/billing) and
  // the auth routes; everything else in the portal redirects to /billing. Runs
  // LAST so the auth/onboarding rules above are unchanged, and reuses the
  // no-self-redirect guard verbatim (locked on /billing returns null).
  if (isAuthenticated && onboardingComplete && access && !access.allow) {
    // Auth routes (/login, /register) pass through — the earlier auth-route
    // rule already handled a signed-in user before reaching here; this is only
    // a defensive no-op so the lockout never bounces a sign-out/switch-account.
    if (isAuthRoute(pathname)) return null;
    // The Upgrade_Page itself (and anything nested under it) must stay
    // reachable while locked so the groomer can subscribe (R3.2).
    if (pathname === '/billing' || pathname.startsWith('/billing/')) return null;
    // Any other portal route -> redirect to /billing (R3.1, R3.3), preserving
    // the no-self-redirect invariant.
    if (isPortalRoute(pathname)) return pathname === '/billing' ? null : '/billing';
    // Public routes (/book, marketing, /pet-card, /t, /claim, /rebook,
    // /credits, demo) are not portal routes, so they fall through and stay up
    // for a locked groomer's clients (R3.6).
  }

  return null;
}

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // --- Pre-launch takeover gate (runs FIRST, before all other rules) ------
    if (isComingSoonEnabled()) {
      const bypassSecret = process.env.COMING_SOON_BYPASS?.trim();
      const previewParam = req.nextUrl.searchParams.get('preview')?.trim();
      const hasCookie = req.cookies.get(COMING_SOON_COOKIE)?.value === '1';

      // A valid ?preview=<secret> grants the bypass and sets a sticky cookie.
      if (bypassSecret && previewParam && previewParam === bypassSecret) {
        const url = req.nextUrl.clone();
        url.searchParams.delete('preview');
        const res = NextResponse.redirect(url);
        res.cookies.set(COMING_SOON_COOKIE, '1', {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 7, // 7 days
        });
        return res;
      }

      // Without the bypass cookie, redirect everything to the coming-soon page.
      if (!hasCookie && !isComingSoonAllowed(pathname)) {
        return NextResponse.redirect(new URL(COMING_SOON_ROUTE, req.url));
      }
    }


    // Derive the billing access decision from the compact JWT claim (no DB /
    // Stripe here). When the claim is absent — e.g. not yet stamped (task 3.3
    // adds stamping) — leave `access` undefined so the lockout rule is skipped
    // and the middleware fails OPEN rather than locking a groomer out on
    // missing billing state.
    const access = token?.access
      ? accessFromClaim(token.access, new Date())
      : undefined;

    const dest = resolveRedirect({
      pathname,
      isAuthenticated: !!token,
      onboardingComplete: token?.onboardingComplete,
      emailVerified: token?.emailVerified,
      access,
    });

    if (dest) {
      return NextResponse.redirect(new URL(dest, req.url));
    }

    // Expose the pathname to Server Components (layouts can't read it directly).
    // The (public) layout reads `x-pathname` to decide whether to render the
    // marketing chrome or hand client-facing shared pages a bare shell.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-pathname', pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  },
  {
    callbacks: {
      /**
       * Gate for whether the request reaches the middleware above. `true` lets
       * it through; `false` triggers NextAuth's redirect to `/login`.
       */
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;

        // During the pre-launch takeover, let EVERY request reach the
        // middleware function so its coming-soon gate (not NextAuth's login
        // bounce) decides the redirect. The gate itself allows /coming-soon and
        // /login through and redirects the rest.
        if (isComingSoonEnabled()) return true;

        // Auth pages are reachable without a session (the middleware function
        // above redirects signed-in users away from them).
        if (isAuthRoute(pathname)) return true;

        // Verification routes (/verify-pending, /verify-email) must stay
        // reachable while unverified so the user can verify — never gate them.
        if (isVerificationRoute(pathname)) return true;

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