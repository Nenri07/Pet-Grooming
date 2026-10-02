/**
 * Service-area polygon geometry (Master Spec §10.4 — drawn service area).
 *
 * A groomer can draw a polygon on a map to describe exactly where they travel,
 * and the booking flow asks "is this client inside it?". This module is the
 * PURE geometry core for that question: types, validation, point-in-polygon,
 * and a tiny normalisation helper. There is no DB, no React, and no network —
 * only math — so it is trivially unit- and property-testable. The combinator
 * that chooses between this polygon gate and the existing radius gate lives
 * next door in `serviceable.ts`; this file stays pure-geometry.
 *
 * ⚠️ COORDINATE ORDER ⚠️
 * {@link LatLng} (used everywhere else in routing) is `{ lat, lng }`, but a
 * {@link GeoPolygon} stores GeoJSON positions, which are `[lng, lat]` — LONGITUDE
 * FIRST. This mismatch is the single most common source of bugs here, so every
 * conversion between the two spaces is called out explicitly below.
 *
 * _Master Spec: §10.4_
 */
import type { LatLng } from '@/lib/routing/geo';

/**
 * A GeoJSON-style Polygon: an array of linear rings, outer ring first, each
 * ring an array of `[lng, lat]` positions (GeoJSON order — longitude first).
 *
 * For v1 only the outer ring (`coordinates[0]`) is used for containment; any
 * further rings (holes) are accepted structurally but ignored by
 * {@link pointInPolygon}. A ring may be stored either explicitly closed (first
 * position repeated at the end, per the GeoJSON spec) or left open — both are
 * handled; {@link normalizePolygon} produces the explicitly-closed form for
 * storage.
 */
export type GeoPolygon = { type: 'Polygon'; coordinates: number[][][] };

/** Whether `v` is a finite number (rejects `NaN`, `±Infinity`, non-numbers). */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Whether `pos` is a valid GeoJSON position `[lng, lat]`: a two-element array of
 * finite numbers with `lng ∈ [-180, 180]` and `lat ∈ [-90, 90]`.
 */
function isValidPosition(pos: unknown): pos is [number, number] {
  if (!Array.isArray(pos) || pos.length < 2) return false;
  const [lng, lat] = pos;
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return false;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

/**
 * Structural + semantic validation for an untrusted value, returning a type
 * guard so callers get a typed {@link GeoPolygon} on success. Never throws —
 * anything malformed yields `false`.
 *
 * A value is a valid polygon when:
 *   - `type === 'Polygon'`,
 *   - `coordinates` is a non-empty array,
 *   - the outer ring (`coordinates[0]`) is an array of valid `[lng, lat]`
 *     positions and has **at least 3** positions. We are deliberately lenient:
 *     a closed GeoJSON ring (≥ 4 positions, last === first) is fine, and so is
 *     an open ring of ≥ 3 distinct points, which we treat as implicitly closed.
 *
 * Note holes (inner rings) are not validated beyond the array shape, since v1
 * containment ignores them.
 */
export function isValidPolygon(poly: unknown): poly is GeoPolygon {
  if (typeof poly !== 'object' || poly === null) return false;
  const p = poly as { type?: unknown; coordinates?: unknown };
  if (p.type !== 'Polygon') return false;
  if (!Array.isArray(p.coordinates) || p.coordinates.length === 0) return false;

  const outer = p.coordinates[0];
  if (!Array.isArray(outer) || outer.length < 3) return false;
  return outer.every(isValidPosition);
}

/**
 * Point-in-polygon test against the OUTER ring (`coordinates[0]`) via standard
 * ray casting. Pure and deterministic; never throws (callers should pass a
 * {@link GeoPolygon} already blessed by {@link isValidPolygon}).
 *
 * `point` is a {@link LatLng}; it is converted into GeoJSON `[lng, lat]` space
 * internally. The ring is handled whether or not it is explicitly closed — the
 * algorithm always walks each edge as `vertex[i] → vertex[i-1]` around the full
 * loop, so a repeated closing vertex is harmless.
 *
 * BOUNDARY RULE: a point lying exactly on an edge or vertex is treated as
 * INSIDE (returns `true`). This is the conservative choice for a service area —
 * a client right on the border is serviceable.
 */
export function pointInPolygon(point: LatLng, poly: GeoPolygon): boolean {
  const ring = poly.coordinates[0];
  if (!ring || ring.length < 3) return false;

  // Convert the LatLng into GeoJSON [lng, lat] space (x = lng, y = lat).
  const x = point.lng;
  const y = point.lat;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];

    // Boundary: a point exactly on this edge counts as inside (closed region).
    if (isOnSegment(x, y, xi, yi, xj, yj)) return true;

    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Whether point `(px, py)` lies on the segment from `(ax, ay)` to `(bx, by)`,
 * within a tiny epsilon for floating-point slack. Used so edge/vertex points
 * resolve to INSIDE per {@link pointInPolygon}'s boundary rule.
 */
function isOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): boolean {
  const EPS = 1e-9;
  // Collinear check: cross product of (b−a) and (p−a) is ~0.
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > EPS) return false;
  // Within the segment's bounding box (with epsilon).
  const withinX = px >= Math.min(ax, bx) - EPS && px <= Math.max(ax, bx) + EPS;
  const withinY = py >= Math.min(ay, by) - EPS && py <= Math.max(ay, by) + EPS;
  return withinX && withinY;
}

/**
 * Return a copy of `poly` whose outer ring is explicitly closed — the first
 * position repeated at the end if it is not already. Pure; the input is not
 * mutated. Call this before storing a drawn polygon so persisted shapes are
 * always valid, explicitly-closed GeoJSON rings.
 *
 * Inner rings (holes), if present, are carried through unchanged.
 */
export function normalizePolygon(poly: GeoPolygon): GeoPolygon {
  const [outer, ...holes] = poly.coordinates;
  const closedOuter = closeRing(outer);
  return { type: 'Polygon', coordinates: [closedOuter, ...holes] };
}

/** Close a single ring: append a copy of the first position if the ring is open. */
function closeRing(ring: number[][]): number[][] {
  if (ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  const alreadyClosed = first[0] === last[0] && first[1] === last[1];
  return alreadyClosed ? [...ring] : [...ring, [first[0], first[1]]];
}
