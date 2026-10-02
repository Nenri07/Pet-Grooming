import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { resolveRedirect } from '@/middleware';
import type { AccessDecision } from '@/lib/billing/access';

/**
 * Middleware redirect-resolution guards.
 *
 * `resolveRedirect` is the pure core of the route-protection middleware. These
 * tests pin down the loop-guard that fixed the Google sign-in hang: the wizard
 * page must never redirect to itself, and an undefined onboarding flag must be
 * treated as incomplete (sending the user to /onboarding, not looping).
 */

// ---------------------------------------------------------------------------
// Example-based edge cases
// ---------------------------------------------------------------------------
describe('resolveRedirect — loop guards', () => {
  it('never redirects /onboarding to itself when onboarding is incomplete', () => {
    expect(
      resolveRedirect({
        pathname: '/onboarding',
        isAuthenticated: true,
        onboardingComplete: false,
      })
    ).toBeNull();
  });

  it('treats an undefined onboarding flag as incomplete (no self-redirect on /onboarding)', () => {
    expect(
      resolveRedirect({
        pathname: '/onboarding',
        isAuthenticated: true,
        onboardingComplete: undefined,
      })
    ).toBeNull();
  });

  it('sends an authenticated, undefined-onboarding user off a portal route to /onboarding', () => {
    expect(
      resolveRedirect({
        pathname: '/dashboard',
        isAuthenticated: true,
        onboardingComplete: undefined,
      })
    ).toBe('/onboarding');
  });

  it('redirects a signed-in incomplete user away from an auth page to /onboarding', () => {
    expect(
      resolveRedirect({
        pathname: '/login',
        isAuthenticated: true,
        onboardingComplete: false,
      })
    ).toBe('/onboarding');
  });

  it('redirects a signed-in complete user away from an auth page to /dashboard', () => {
    expect(
      resolveRedirect({
        pathname: '/register',
        isAuthenticated: true,
        onboardingComplete: true,
      })
    ).toBe('/dashboard');
  });

  it('sends an unauthenticated portal visitor to /login', () => {
    expect(
      resolveRedirect({
        pathname: '/dashboard',
        isAuthenticated: false,
        onboardingComplete: undefined,
      })
    ).toBe('/login');
  });

  it('lets a completed groomer reach the dashboard', () => {
    expect(
      resolveRedirect({
        pathname: '/dashboard',
        isAuthenticated: true,
        onboardingComplete: true,
      })
    ).toBeNull();
  });

  it('lets an unauthenticated visitor reach public routes', () => {
    expect(
      resolveRedirect({
        pathname: '/book/some-groomer',
        isAuthenticated: false,
        onboardingComplete: undefined,
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property: the resolver can never redirect a path to itself (no ping-pong).
// ---------------------------------------------------------------------------
describe('resolveRedirect — never self-redirects', () => {
  const pathArb = fc.constantFrom(
    '/',
    '/login',
    '/register',
    '/onboarding',
    '/onboarding/step-2',
    '/dashboard',
    '/dashboard/overview',
    '/clients',
    '/appointments/123',
    '/book/foo',
    '/pet-card/abc'
  );

  it('for any state, the resolved destination is never the current path', () => {
    fc.assert(
      fc.property(
        pathArb,
        fc.boolean(),
        fc.constantFrom(true, false, undefined),
        (pathname, isAuthenticated, onboardingComplete) => {
          const dest = resolveRedirect({
            pathname,
            isAuthenticated,
            onboardingComplete,
          });
          if (dest !== null) {
            expect(dest).not.toBe(pathname);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments — hard-lockout (R3) example cases.
//
// A locked groomer is authenticated + onboardingComplete:true with an access
// decision of `{ allow: false, reason }`. The lockout rule runs LAST, so it may
// only redirect a groomer OFF a portal route to /billing; the Upgrade_Page
// (/billing and nested) and public routes stay reachable. Auth routes
// (/login, /register) are handled by the EARLIER signed-in-bounce rule, which
// sends an onboarded user to /dashboard before the lockout branch is reached —
// so a locked groomer is never held on an auth page, but also never pushed into
// the locked portal from one.
// ---------------------------------------------------------------------------
describe('resolveRedirect — hard lockout (Feature: billing-trial-and-payments)', () => {
  const lockReasons = ['trial_expired', 'inactive'] as const;

  for (const reason of lockReasons) {
    const locked: AccessDecision = { allow: false, reason };

    describe(`locked groomer (reason: ${reason})`, () => {
      it('redirects off /dashboard to /billing', () => {
        expect(
          resolveRedirect({
            pathname: '/dashboard',
            isAuthenticated: true,
            onboardingComplete: true,
            access: locked,
          })
        ).toBe('/billing');
      });

      it('redirects off /clients to /billing', () => {
        expect(
          resolveRedirect({
            pathname: '/clients',
            isAuthenticated: true,
            onboardingComplete: true,
            access: locked,
          })
        ).toBe('/billing');
      });

      it('lets the groomer stay on /billing (no self-redirect; Upgrade_Page reachable)', () => {
        expect(
          resolveRedirect({
            pathname: '/billing',
            isAuthenticated: true,
            onboardingComplete: true,
            access: locked,
          })
        ).toBeNull();
      });

      it('lets the groomer reach a nested /billing/invoices page', () => {
        expect(
          resolveRedirect({
            pathname: '/billing/invoices',
            isAuthenticated: true,
            onboardingComplete: true,
            access: locked,
          })
        ).toBeNull();
      });

      // Auth routes: the EARLIER signed-in-on-auth-page rule fires before the
      // lockout rule, so an onboarded groomer on /login or /register is sent to
      // /dashboard (the normal "you're already signed in" bounce), NOT held on
      // the auth page and NOT redirected to /billing. The lockout rule's own
      // auth-route branch is a defensive no-op that is never reached here. The
      // critical guarantee preserved is: a locked groomer is never redirected
      // INTO a locked target from an auth route — the destination is the usual
      // auth-route bounce, and never a self-redirect.
      it('bounces /login to /dashboard via the pre-lockout auth-route rule (not /billing, not self)', () => {
        const dest = resolveRedirect({
          pathname: '/login',
          isAuthenticated: true,
          onboardingComplete: true,
          access: locked,
        });
        expect(dest).toBe('/dashboard');
        expect(dest).not.toBe('/login');
        expect(dest).not.toBe('/billing');
      });

      it('bounces /register to /dashboard via the pre-lockout auth-route rule (not /billing, not self)', () => {
        const dest = resolveRedirect({
          pathname: '/register',
          isAuthenticated: true,
          onboardingComplete: true,
          access: locked,
        });
        expect(dest).toBe('/dashboard');
        expect(dest).not.toBe('/register');
        expect(dest).not.toBe('/billing');
      });

      it('keeps the public booking page /book/foo up (R3.6)', () => {
        expect(
          resolveRedirect({
            pathname: '/book/foo',
            isAuthenticated: true,
            onboardingComplete: true,
            access: locked,
          })
        ).toBeNull();
      });
    });
  }

  describe('allow state leaves prior behavior unchanged', () => {
    const allow: AccessDecision = { allow: true };

    it('lets a completed groomer reach /dashboard with access:{allow:true}', () => {
      expect(
        resolveRedirect({
          pathname: '/dashboard',
          isAuthenticated: true,
          onboardingComplete: true,
          access: allow,
        })
      ).toBeNull();
    });

    it('matches the no-access-param result for a completed groomer on /dashboard', () => {
      const withAllow = resolveRedirect({
        pathname: '/dashboard',
        isAuthenticated: true,
        onboardingComplete: true,
        access: allow,
      });
      const withoutAccess = resolveRedirect({
        pathname: '/dashboard',
        isAuthenticated: true,
        onboardingComplete: true,
      });
      expect(withAllow).toBe(withoutAccess);
    });
  });

  describe('backward compatibility — omitting access never triggers a lockout', () => {
    it('does not redirect a completed groomer off a portal route when access is omitted', () => {
      expect(
        resolveRedirect({
          pathname: '/dashboard',
          isAuthenticated: true,
          onboardingComplete: true,
        })
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Property 5 (extended) — the no-self-redirect invariant holds WITH lockout.
//
// Feature: billing-trial-and-payments. The generator now also varies `access`
// across undefined | allow | both lockout reasons, so the resolved destination
// is never equal to the current path for ANY combination of
// pathname/auth/onboarding/access. It additionally pins that a locked groomer
// is never redirected AWAY from /billing or an auth route.
// ---------------------------------------------------------------------------
describe('resolveRedirect — never self-redirects WITH lockout (Feature: billing-trial-and-payments)', () => {
  const pathArb = fc.constantFrom(
    '/',
    '/login',
    '/register',
    '/onboarding',
    '/onboarding/step-2',
    '/dashboard',
    '/dashboard/overview',
    '/clients',
    '/appointments/123',
    '/billing',
    '/billing/invoices',
    '/book/foo',
    '/pet-card/abc'
  );

  const accessArb = fc.constantFrom<AccessDecision | undefined>(
    undefined,
    { allow: true },
    { allow: false, reason: 'trial_expired' },
    { allow: false, reason: 'inactive' }
  );

  it('for any state (incl. access), the resolved destination is never the current path', () => {
    fc.assert(
      fc.property(
        pathArb,
        fc.boolean(),
        fc.constantFrom(true, false, undefined),
        accessArb,
        (pathname, isAuthenticated, onboardingComplete, access) => {
          const dest = resolveRedirect({
            pathname,
            isAuthenticated,
            onboardingComplete,
            access,
          });
          if (dest !== null) {
            expect(dest).not.toBe(pathname);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  const lockArb = fc.constantFrom<AccessDecision>(
    { allow: false, reason: 'trial_expired' },
    { allow: false, reason: 'inactive' }
  );

  it('a locked groomer is never redirected away from /billing (Upgrade_Page stays reachable)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('/billing', '/billing/invoices'),
        lockArb,
        (pathname, access) => {
          expect(
            resolveRedirect({
              pathname,
              isAuthenticated: true,
              onboardingComplete: true,
              access,
            })
          ).toBeNull();
        }
      ),
      { numRuns: 500 }
    );
  });

  it('a locked groomer on an auth route is never bounced to a locked target or back to itself', () => {
    // The pre-lockout auth-route rule bounces a signed-in onboarded user off
    // /login or /register to /dashboard; the lockout rule never redirects them
    // INTO the locked portal from an auth route, and never self-redirects.
    fc.assert(
      fc.property(
        fc.constantFrom('/login', '/register'),
        lockArb,
        (pathname, access) => {
          const dest = resolveRedirect({
            pathname,
            isAuthenticated: true,
            onboardingComplete: true,
            access,
          });
          expect(dest).toBe('/dashboard');
          expect(dest).not.toBe(pathname);
          expect(dest).not.toBe('/billing');
        }
      ),
      { numRuns: 500 }
    );
  });
});
