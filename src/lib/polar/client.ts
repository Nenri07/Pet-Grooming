/**
 * Polar client singleton (mirrors @/lib/stripe/client getStripe()).
 *
 * Import-safe: importing this module never throws, even with no credentials.
 * getPolar() throws only when actually CALLED while unconfigured — callers
 * guard with isPolarConfigured() first and degrade gracefully.
 *
 * The installed @polar-sh/sdk is date-versioned: the client comes from the
 * `@polar-sh/sdk/2026-10` subpath via the functional `createPolar(...)`
 * factory (NOT `new Polar()`), and webhook verification uses `webhooks
 * .validateEvent` from the same subpath (we do NOT use @polar-sh/nextjs,
 * which requires Next 15/16 — this app is Next 14).
 */
import { createPolar } from '@polar-sh/sdk/2026-10';

const ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN ?? '';

/** 'sandbox' | 'production' from POLAR_SERVER, else derived from NODE_ENV. */
export function resolvePolarServer(): 'sandbox' | 'production' {
  const explicit = process.env.POLAR_SERVER?.trim().toLowerCase();
  if (explicit === 'production' || explicit === 'sandbox') return explicit;
  return process.env.NODE_ENV === 'production' ? 'production' : 'sandbox';
}

/**
 * Loosely typed on purpose. `ReturnType<typeof createPolar>` expands to an
 * enormous nested type that overflows the TypeScript compiler's stack on this
 * toolchain. We keep the client as a minimal structural type exposing only the
 * namespaces this app uses, so tsc never has to expand the full SDK graph.
 */
type PolarClient = {
  checkouts: { create: (body: unknown) => Promise<{ url?: string | null } & Record<string, unknown>> };
  customerSessions: { create: (body: unknown) => Promise<Record<string, unknown>> };
};
let singleton: PolarClient | null = null;

/** Whether the Polar access token is present (lightweight; no network). */
export function isPolarClientConfigured(): boolean {
  return ACCESS_TOKEN.trim().length > 0;
}

/**
 * Lazily-constructed Polar client. Throws a clear error if the access token
 * is missing; guard with isPolarConfigured()/isPolarClientConfigured() when a
 * graceful fallback is needed instead of an exception.
 */
export function getPolar(): PolarClient {
  if (!isPolarClientConfigured()) {
    throw new Error('Polar is not configured: POLAR_ACCESS_TOKEN is missing.');
  }
  if (!singleton) {
    singleton = createPolar({
      accessToken: ACCESS_TOKEN,
      environment: resolvePolarServer(),
    }) as unknown as PolarClient;
  }
  return singleton;
}
