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
 * Factory returning the geocoder to use. Today this is always the null
 * provider. When a vendor key is configured, return the real provider here.
 */
export function getGeocodeProvider(): GeocodeProvider {
  // TODO(geocoder): if (process.env.MAPBOX_TOKEN) return new MapboxGeocodeProvider();
  return new NullGeocodeProvider();
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
