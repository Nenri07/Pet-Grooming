/**
 * Mapbox Directions travel provider (Master Spec §10.2).
 *
 * Real road times/distances behind the {@link TravelProvider} seam. For a
 * single origin→destination pair it calls the Mapbox Directions API (driving
 * profile), which returns BOTH `duration` (seconds) and `distance` (meters) in
 * one response — so a single fetch services both `minutes` and `km`.
 *
 * Resolved pairs are cached in Redis under `tt:{hash(a)}:{hash(b)}` for 7 days
 * (§10.2, see `redis.ts` TTL.TRAVEL), keyed by a short hash of each point rounded to
 * 5 decimals so near-identical coordinates share a key.
 *
 * It is deliberately defensive: EVERY failure path (non-ok response, bad JSON,
 * no routes, timeout, network error) falls back to the internal
 * {@link HaversineTravelProvider} result for that call, so a number is always
 * returned and routing never hard-fails on a network blip. Cache reads/writes
 * are best-effort — a Redis hiccup never fails a lookup.
 *
 * To match the haversine provider's contract, the cfg `parkingMin` is added to
 * the road `minutes` returned by Mapbox (the Directions duration is drive time
 * only).
 *
 * _Master Spec: §10.2_
 */
import {
  HaversineTravelProvider,
  type LatLng,
  type TravelCfg,
  type TravelProvider,
} from '@/lib/routing/geo';
import { cacheGet, cacheSet, keys, TTL, isRedisConfigured } from '@/lib/redis';

/** A resolved travel estimate for one point pair. */
interface Route {
  minutes: number;
  km: number;
}

/**
 * Mapbox Directions-backed travel provider. Falls back to haversine on any
 * error so callers always get a number.
 */
export class MapboxMatrixProvider implements TravelProvider {
  private readonly fallback: HaversineTravelProvider;

  constructor(
    private readonly cfg: TravelCfg,
    private readonly token: string
  ) {
    this.fallback = new HaversineTravelProvider(cfg);
  }

  async minutes(a: LatLng, b: LatLng): Promise<number> {
    const route = await this.fetchRoute(a, b);
    if (route) return route.minutes;
    return this.fallback.minutes(a, b);
  }

  async km(a: LatLng, b: LatLng): Promise<number> {
    const route = await this.fetchRoute(a, b);
    if (route) return route.km;
    return this.fallback.km(a, b);
  }

  /**
   * A short, stable hash of the point rounded to 5 decimals — the per-point
   * cache discriminator so near-identical coordinates share a `tt:` key
   * (§10.2). Uses a dependency-free FNV-1a (no `node:crypto`) so this module
   * stays safe to pull into a client bundle via `geo.ts`; a cache key only
   * needs to be a stable discriminator, not cryptographic.
   */
  private hashPoint(p: LatLng): string {
    const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      // multiply by the FNV prime (16777619) in 32-bit space
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /**
   * Resolve a single origin→dest pair to `{ minutes, km }`, or `null` on any
   * failure. Consults the Redis cache first, then the Mapbox Directions API,
   * then writes a successful result back. The returned `minutes` includes the
   * cfg `parkingMin` so it matches the haversine provider's contract.
   */
  private async fetchRoute(a: LatLng, b: LatLng): Promise<Route | null> {
    const cacheKey = keys.travelTime(this.hashPoint(a), this.hashPoint(b));

    // 1. Cache hit?
    if (isRedisConfigured()) {
      const cached = await cacheGet<Route>(cacheKey).catch(() => null);
      if (cached && typeof cached.minutes === 'number' && typeof cached.km === 'number') {
        return cached;
      }
    }

    // 2. Network resolve. Any failure → null (never throw).
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const url =
        `https://api.mapbox.com/directions/v5/mapbox/driving/` +
        `${a.lng},${a.lat};${b.lng},${b.lat}` +
        `?access_token=${encodeURIComponent(this.token)}&overview=false`;

      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) return null;

      const body = (await res.json()) as unknown;
      const routes = (body as { routes?: unknown }).routes;
      const first = Array.isArray(routes) ? routes[0] : undefined;
      if (!first || typeof first !== 'object') return null;

      const durationSec = Number((first as { duration?: unknown }).duration);
      const distanceMeters = Number((first as { distance?: unknown }).distance);
      if (!Number.isFinite(durationSec) || !Number.isFinite(distanceMeters)) return null;

      const route: Route = {
        minutes: durationSec / 60 + this.cfg.parkingMin,
        km: distanceMeters / 1000,
      };

      // 3. Best-effort cache write.
      if (isRedisConfigured()) {
        await cacheSet(cacheKey, route, TTL.TRAVEL).catch(() => {});
      }

      return route;
    } catch {
      // Timeout, DNS/network error, bad JSON, etc. → caller falls back to haversine.
      return null;
    }
  }
}
