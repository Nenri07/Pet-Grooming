/**
 * Service-area precedence combinator (Master Spec §10.4).
 *
 * The booking flow needs a single yes/no gate — "can this client be served?" —
 * that composes the two independent primitives without entangling them:
 *   - the drawn-polygon gate ({@link pointInPolygon} in `service-area.ts`), and
 *   - the existing circle/radius gate ({@link isWithinServiceRadius} in
 *     `scoring.ts`).
 *
 * PRECEDENCE: a defined polygon is authoritative. If the groomer has drawn a
 * valid polygon, the radius is ignored entirely and serviceability is purely
 * point-in-polygon. Only when there is NO (or an invalid) polygon do we fall
 * back to the existing radius behaviour. This keeps both primitives pure and
 * separately testable; the policy lives only here.
 *
 * _Master Spec: §10.4_
 */
import type { LatLng } from '@/lib/routing/geo';
import { isWithinServiceRadius } from '@/lib/routing/scoring';
import { isValidPolygon, pointInPolygon, type GeoPolygon } from '@/lib/routing/service-area';

/**
 * Whether a client is serviceable, applying service-area precedence (above).
 *
 * - If `polygon` is a valid {@link GeoPolygon}: serviceable iff a `point` is
 *   provided AND it falls inside the polygon. A missing point when a polygon is
 *   enforced is a CONSERVATIVE "not serviceable" — we never claim coverage for
 *   an unknown location once the groomer has drawn an explicit boundary.
 * - Otherwise (no polygon, or a malformed one): fall back to the radius gate.
 *   A `null` `fromBaseKm` means the distance is unknown with no polygon to
 *   enforce, so we DON'T block (returns `true`) — matching the pass-through
 *   philosophy of the existing radius filter. A known distance defers to
 *   {@link isWithinServiceRadius}, where a missing radius also means "no limit".
 */
export function isServiceable(args: {
  point: LatLng | null;
  polygon: GeoPolygon | null | undefined;
  fromBaseKm: number | null;
  serviceRadiusKm: number | null | undefined;
}): boolean {
  const { point, polygon, fromBaseKm, serviceRadiusKm } = args;

  // Polygon is authoritative when present and valid.
  if (isValidPolygon(polygon)) {
    return point != null && pointInPolygon(point, polygon);
  }

  // No/invalid polygon → fall back to the existing radius behaviour.
  if (fromBaseKm == null) return true;
  return isWithinServiceRadius(fromBaseKm, serviceRadiusKm ?? null);
}
