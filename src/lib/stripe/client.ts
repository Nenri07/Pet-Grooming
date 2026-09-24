/**
 * Server-side Stripe SDK singleton.
 *
 * Initializes the Stripe Node SDK from the `STRIPE_SECRET_KEY` environment
 * variable. This module MUST only ever be imported from server-side code
 * (server actions, route handlers, webhooks) — never from a client component,
 * because it carries the secret key.
 *
 * The key may be absent during local development (see `.env`, where the
 * publishable key is intentionally empty until the user adds theirs). Rather
 * than throwing at import time — which would crash unrelated server code and
 * make the whole app un-buildable — we lazily construct the client and expose
 * {@link getStripe}, which throws a clear error only when a payment operation
 * is actually attempted without a configured key. Callers that want to degrade
 * gracefully can first check {@link isStripeConfigured}.
 *
 * The API version is intentionally left unset so the SDK uses the version
 * pinned to the installed library, avoiding drift between the runtime version
 * and the TypeScript types shipped with the package.
 *
 * _Requirements: 7.1, 7.2, 7.6_
 */
import Stripe from 'stripe';

/** The server secret key, read once at module load. */
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';

/** Cached SDK instance so we don't re-create it on every call. */
let stripeSingleton: Stripe | null = null;

/**
 * Whether a usable Stripe secret key is configured. Server code can use this
 * to decide whether to attempt a payment operation or degrade gracefully with
 * a "payment temporarily unavailable" message (Requirement 7.6).
 */
export function isStripeConfigured(): boolean {
  return STRIPE_SECRET_KEY.length > 0;
}

/**
 * Return the shared server Stripe client, constructing it on first use.
 *
 * @throws {Error} when `STRIPE_SECRET_KEY` is not configured. Callers that need
 * to degrade gracefully should guard with {@link isStripeConfigured} first.
 */
export function getStripe(): Stripe {
  if (!isStripeConfigured()) {
    throw new Error(
      'Stripe is not configured: STRIPE_SECRET_KEY is missing from the environment.'
    );
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(STRIPE_SECRET_KEY, {
      typescript: true,
      appInfo: { name: 'PawPort' },
    });
  }
  return stripeSingleton;
}
