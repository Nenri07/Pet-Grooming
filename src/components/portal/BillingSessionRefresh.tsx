'use client';

import * as React from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * BillingSessionRefresh — promptly lifts the hard lockout after a groomer
 * returns from Stripe Checkout (billing-trial-and-payments, task 4.6 glue).
 *
 * The lockout is enforced by the middleware from the compact `access` claim on
 * the NextAuth JWT. That claim is the source of truth for lockout and is
 * re-derived from the local Subscription in the `jwt` callback at sign-in, on an
 * explicit `update()` (`trigger === 'update'`), or after a short (~5 min) TTL.
 * The webhook flips the Subscription to `active`, but the already-issued token
 * keeps its stale `trial_expired`/`inactive` claim until one of those happens.
 *
 * When Checkout succeeds the groomer lands on `/billing?checkout=success` (or a
 * trial start lands on `/billing?trial=started`). This component fires a single
 * `useSession().update()` on that landing so the `jwt` callback re-stamps the
 * access claim right away — the lockout lifts without waiting out the TTL. It
 * is deliberately NOT a polling loop: the webhook remains the source of truth
 * and the TTL is the backstop; one refresh is enough.
 *
 * Renders nothing. Theme-safe (no DOM output), dependency-light (NextAuth +
 * Next navigation only).
 */
export function BillingSessionRefresh(): null {
  const { update } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  // The success signals written by the billing server actions' successUrl.
  const checkoutSuccess = searchParams.get('checkout') === 'success';
  const trialStarted = searchParams.get('trial') === 'started';
  const shouldRefresh = checkoutSuccess || trialStarted;

  // Guard so React Strict Mode's double-invoke (dev) doesn't refresh twice.
  const didRefresh = React.useRef(false);
  // Follow-up re-check timers. Held in a ref (not cleaned up by the effect
  // below) because `router.replace('/billing')` drops the query param, which
  // flips `shouldRefresh` and would otherwise cancel them straight away.
  const timersRef = React.useRef<number[]>([]);
  React.useEffect(() => {
    const timers = timersRef;
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  React.useEffect(() => {
    if (!shouldRefresh || didRefresh.current) return;
    didRefresh.current = true;

    // Force the jwt callback to re-derive `token.access` from the now-active
    // Subscription, then drop the one-shot query param so a reload / back nav
    // doesn't re-trigger. Both are best-effort — a failure just means the TTL
    // backstop applies.
    void update().finally(() => router.refresh());
    router.replace('/billing');

    // The payment webhook can land a few seconds AFTER the customer returns
    // from checkout. The portal layout (which holds the "Trial ended" banner)
    // is not re-rendered by client navigation, so it would keep showing the
    // pre-payment state until a hard reload. Re-check a few times over ~15s;
    // each refresh re-renders the server tree and the banner clears as soon as
    // the subscription is active. Bounded, not a polling loop.
    timersRef.current = [3000, 8000, 15000].map((ms) =>
      window.setTimeout(() => {
        void update().finally(() => router.refresh());
      }, ms)
    );
  }, [shouldRefresh, update, router]);

  return null;
}

export default BillingSessionRefresh;
