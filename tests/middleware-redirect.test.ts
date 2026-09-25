import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { resolveRedirect } from '@/middleware';

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
