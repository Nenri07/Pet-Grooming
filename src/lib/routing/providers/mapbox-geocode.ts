/**
 * Mapbox Geocoding provider (Master Spec §10.1, §15).
 *
 * Resolves an address to `{ lat, lng }` using the Mapbox Geocoding v6 forward
 * endpoint. It is the real provider that slots in behind the
 * {@link GeocodeProvider} seam when `MAPBOX_TOKEN` is configured; otherwise
 * routing degrades to the free {@link module:lib/routing/providers/geocode}
 * Nominatim provider.
 *
 * It mirrors `NominatimGeocodeProvider`'s defensive style exactly: EVERY
 * failure path (empty input, network error, timeout, malformed/out-of-range
 * result) resolves to `null` rather than throwing, so routing degrades to a
 * safe pass-through and booking keeps working with an unknown location.
 *
 * Caching mirrors the sibling providers: on a cache hit we return the stored
 * coordinate; on a successful resolve we write it back under
 * `geo:{sha1(address)}` for 30 days (§10.1). Both cache steps are best-effort —
 * a Redis hiccup never fails a geocode.
 *
 * _Master Spec: §10.1, §15_
 */
import type { LatLng } from '@/lib/routing/geo';
import {
  addressHash,
  normalizeAddress,
  type GeocodeProvider,
} from '@/lib/routing/providers/geocode';
import { cacheGet, cacheSet, keys, TTL, isRedisConfigured } from '@/lib/redis';

/** Mapbox-backed forward geocoder. Returns `null` on any failure. */
export class MapboxGeocodeProvider implements GeocodeProvider {
  constructor(private readonly token: string) {}

  async geocode(address: string): Promise<LatLng | null> {
    if (!address || !address.trim()) return null;

    // 1. Cache hit? (same pattern as the Nominatim provider.)
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
        'https://api.mapbox.com/search/geocode/v6/forward?limit=1&q=' +
        encodeURIComponent(normalizeAddress(address)) +
        '&access_token=' +
        encodeURIComponent(this.token);

      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) return null;

      const body = (await res.json()) as unknown;
      const features = (body as { features?: unknown }).features;
      const first = Array.isArray(features) ? features[0] : undefined;
      if (!first || typeof first !== 'object') return null;

      const geometry = (first as { geometry?: unknown }).geometry;
      const coordinates =
        geometry && typeof geometry === 'object'
          ? (geometry as { coordinates?: unknown }).coordinates
          : undefined;
      if (!Array.isArray(coordinates)) return null;

      // Mapbox returns [lng, lat].
      const lng = Number(coordinates[0]);
      const lat = Number(coordinates[1]);

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
