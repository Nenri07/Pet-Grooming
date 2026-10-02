/**
 * Travel-time & distance primitives for Order Radar (Master Spec §10.2).
 *
 * Everything here is pure math (haversine + a road factor). The default
 * {@link HaversineTravelProvider} needs no network, no API key, and no account
 * — it is what the whole routing pipeline runs on today. An optional
 * `MapboxMatrixProvider` can slot in behind the same {@link TravelProvider}
 * interface later for real road times, caching pairs in Redis; see the seam at
 * the bottom of this file.
 *
 * _Master Spec: §10.2_
 */
import { isMapboxConfigured, getMapboxToken } from '@/lib/routing/config';
import { MapboxMatrixProvider } from '@/lib/routing/providers/mapbox-travel';

/** A geographic point. */
export type LatLng = { lat: number; lng: number };

/**
 * Great-circle distance between two points in kilometres (R = 6371 km).
 * Verbatim from Master Spec §10.2.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371,
    toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat),
    dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Tuning knobs for the default (haversine) travel model. */
export interface TravelCfg {
  /** Multiplier applied to straight-line distance to approximate road distance. */
  roadFactor: number;
  /** Assumed average driving speed, km/h. */
  avgSpeedKmh: number;
  /** Fixed minutes added per leg for parking/setup. */
  parkingMin: number;
}

/**
 * Pluggable travel estimator. `minutes` is drive time (incl. parking) between
 * two points; `km` is drive distance. Async so a real matrix provider (HTTP)
 * can implement the same shape.
 */
export interface TravelProvider {
  minutes(a: LatLng, b: LatLng): Promise<number>;
  km(a: LatLng, b: LatLng): Promise<number>;
}

/**
 * Default provider — pure haversine, no external service.
 *
 * `minutes = (haversineKm * roadFactor / avgSpeedKmh) * 60 + parkingMin`
 * `km      = haversineKm`
 */
export class HaversineTravelProvider implements TravelProvider {
  constructor(private readonly cfg: TravelCfg) {}

  async minutes(a: LatLng, b: LatLng): Promise<number> {
    const km = haversineKm(a, b);
    const { roadFactor, avgSpeedKmh, parkingMin } = this.cfg;
    return (km * roadFactor) / avgSpeedKmh * 60 + parkingMin;
  }

  async km(a: LatLng, b: LatLng): Promise<number> {
    return haversineKm(a, b);
  }
}

/** Master Spec §10.1 defaults, applied when a profile leaves a field unset. */
export const DEFAULT_TRAVEL_CFG: TravelCfg = {
  roadFactor: 1.35,
  avgSpeedKmh: 32,
  parkingMin: 3,
};

/**
 * Factory returning the travel provider to use.
 *
 * WIRED (§10.2): when `MAPBOX_TOKEN` is configured, this returns a
 * {@link MapboxMatrixProvider} that:
 *   - calls the Mapbox Directions API (driving profile) for `minutes`/`km`,
 *   - caches each pair in Redis under `keys.travelTime(hash(a), hash(b))`
 *     (`tt:{hash(a)}:{hash(b)}`) for 7 days (see `redis.ts` TTL.TRAVEL),
 *   - falls back to {@link HaversineTravelProvider} on any error or cache miss +
 *     API failure, so routing never hard-fails on a network blip.
 * When the token is unset/placeholder it returns the default haversine
 * provider — no Mapbox account is required to ship Phase 3.
 *
 * `MapboxMatrixProvider` only imports types + the haversine value from this
 * module and executes no geo code at load, so the value import below is a
 * safe (CALL-time only) cycle.
 */
export function getTravelProvider(cfg: TravelCfg = DEFAULT_TRAVEL_CFG): TravelProvider {
  if (isMapboxConfigured()) {
    const token = getMapboxToken();
    if (token) return new MapboxMatrixProvider(cfg, token);
  }
  return new HaversineTravelProvider(cfg);
}
