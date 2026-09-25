/**
 * Order Radar routing — barrel export (Master Spec §10).
 *
 * Pure geo/insertion/scoring plus the geocode provider seam. Import from
 * `@/lib/routing` rather than reaching into individual files.
 *
 * _Master Spec: §10_
 */
export * from '@/lib/routing/geo';
export * from '@/lib/routing/insertion';
export * from '@/lib/routing/scoring';
export * from '@/lib/routing/providers/geocode';

import { DEFAULT_TRAVEL_CFG } from '@/lib/routing/geo';

/**
 * Default routing configuration (Master Spec §10.1 defaults). Callers merge a
 * groomer's profile overrides on top of these.
 */
export const ROUTING = {
  /** Haversine travel model defaults (roadFactor 1.35, 32 km/h, 3 min parking). */
  travel: DEFAULT_TRAVEL_CFG,
  /** Default buffer between stops, minutes (§9.2). */
  bufferMin: 10,
  /** Default max detour hidden-from-client threshold, minutes (§10.1). */
  maxDetourMin: 25,
  /** Dashboard radar poll interval, seconds (§10.5 step 4). */
  radarPollSeconds: 15,
  /** Distance under which two stops count toward a "cluster day", km (§10.4). */
  clusterKm: 8,
} as const;
