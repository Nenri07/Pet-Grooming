/**
 * Geocoding provider behind an interface (Master Spec §10.1, §15).
 *
 * Turns a client's service address into `{ lat, lng }` so routing can score
 * slots. Every third-party sits behind an interface (§0 rule 5), so a real
 * provider (Mapbox / Geoapify / LocationIQ) can be dropped in later without
 * touching callers.
 *
 * TODAY there is no geocoding service wired up (no Mapbox key), so the default
 * provider returns `null` for every address. Callers MUST treat a `null`
 * location gracefully: routing becomes a pass-through (all slots pass, unranked)
 * so booking keeps working with an unknown location.
 *
 * Results are cached in Redis under `geo:{sha1(normalizedAddress)}` for 30 days
 * (§10.1) — the cache seam is in place even though the default never produces a
 * hit to store.
 *
 * _Master Spec: §10.1, §15_
 */
import { createHash } from 'node:crypto';
import type { LatLng } from '@/lib/routing/geo';
import { cacheGet, cacheSet, keys, TTL, isRedisConfigured } from '@/lib/redis';

/** Pluggable geocoder. Returns `null` when an address can't be resolved. */
export interface GeocodeProvider {
  geocode(address: string): Promise<LatLng | null>;
}

/**
 * Normalize an address for stable cache keys: trim, collapse whitespace,
 * lowercase. Two spellings that differ only by casing/spacing share a key.
 */
export function normalizeAddress(address: string): string {
  return address.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** sha1 of the normalized address — the cache key discriminator (§10.1). */
export function addressHash(address: string): string {
  return createHash('sha1').update(normalizeAddress(address)).digest('hex');
}

/**
 * Default provider: no external geocoding service configured.
 *
 * It consults the Redis cache (so a previously-stored coordinate — e.g. written
 * by a future real provider — is still returned), but never calls out to a
 * network service, and returns `null` on a miss. This keeps Phase 3 shippable
 * with zero API accounts.
 *
 * SEAM: to add real geocoding, implement `GeocodeProvider` (e.g.
 * `MapboxGeocodeProvider`) that calls the vendor API on a cache miss and writes
 * the result back via `cacheSet(keys.geocode(addressHash(address)), coord,
 * TTL.GEOCODE)`. Then have {@link getGeocodeProvider} return it when the vendor
 * key is present.
 */
export class NullGeocodeProvider implements GeocodeProvider {
  async geocode(address: string): Promise<LatLng | null> {
    if (!address || !address.trim()) return null;

    if (isRedisConfigured()) {
      const cached = await cacheGet<LatLng>(keys.geocode(addressHash(address))).catch(() => null);
      if (cached && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
        return cached;
      }
    }

    // No geocoding service configured → unknown location.
    return null;
  }
}

/**
 * OpenStreetMap Nominatim geocoder — free, no API key (§10.1, §15).
 *
 * Resolves an address to `{ lat, lng }` using the public Nominatim search
 * endpoint. It is deliberately defensive: EVERY failure path (empty input,
 * network error, timeout, malformed/out-of-range result) resolves to `null`
 * rather than throwing, so routing degrades to a safe pass-through and booking
 * keeps working with an unknown location.
 *
 * Caching mirrors {@link NullGeocodeProvider}: on a cache hit we return the
 * stored coordinate; on a successful network resolve we write it back under
 * `geo:{sha1(address)}` for 30 days (§10.1). Both cache steps are best-effort —
 * a Redis hiccup never fails a geocode.
 *
 * Per Nominatim usage policy we send a descriptive `User-Agent`, request a
 * single result, and bound the call with a 6s timeout.
 */
export class NominatimGeocodeProvider implements GeocodeProvider {
  async geocode(address: string): Promise<LatLng | null> {
    if (!address || !address.trim()) return null;

    // 1. Cache hit? (same pattern as the null provider.)
    if (isRedisConfigured()) {
      const cached = await cacheGet<LatLng>(keys.geocode(addressHash(address))).catch(() => null);
      if (cached && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
        return cached;
      }
    }

    // 2. Network resolve. Any failure → null (never throw).
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const url =
        'https://nominatim.openstreetmap.org/search?format=jsonc&limit=1&q=' +
        encodeURIComponent(address);

      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            // Required by Nominatim's usage policy.
            'User-Agent': 'Pawxis/1.0 (pet grooming scheduler)',
            'Accept-Language': 'en',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) return null;

      const body = (await res.json()) as unknown;
      const first = Array.isArray(body) ? body[0] : undefined;
      if (!first || typeof first !== 'object') return null;

      const lat = Number((first as { lat?: unknown }).lat);
      const lng = Number((first as { lon?: unknown }).lon);

      const valid =
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;
      if (!valid) return null;

      const coord: LatLng = { lat, lng };

      // 3. Best-effort cache write.
      if (isRedisConfigured()) {
        await cacheSet(keys.geocode(addressHash(address)), coord, TTL.GEOCODE).catch(() => {});
      }

      return coord;
    } catch {
      // Timeout, DNS/network error, bad JSON, etc. → degrade to pass-through.
      return null;
    }
  }
}

/**
 * Factory returning the geocoder to use. Defaults to the free Nominatim
 * provider (no API key). When a vendor key is configured, return the real
 * provider here.
 */
export function getGeocodeProvider(): GeocodeProvider {
  // TODO(geocoder): if (process.env.MAPBOX_TOKEN) return new MapboxGeocodeProvider();
  return new NominatimGeocodeProvider();
}

/**
 * Convenience: geocode a full structured address (as stored on Client) into a
 * single string and resolve it. Returns `null` when unresolved.
 */
export async function geocodeStructured(
  parts: { street?: string; city?: string; state?: string; postalCode?: string },
  provider: GeocodeProvider = getGeocodeProvider()
): Promise<LatLng | null> {
  const address = [parts.street, parts.city, parts.state, parts.postalCode]
    .filter(Boolean)
    .join(', ');
  if (!address) return null;
  return provider.geocode(address);
}

// Re-export for callers writing their own real provider that stores results.
export { keys as redisKeys, TTL as redisTTL };
