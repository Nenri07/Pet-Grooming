/**
 * Service-area polygon geometry — unit + property tests (Master Spec §10.4).
 *
 * Covers the pure geometry core (`service-area.ts`) and the precedence
 * combinator (`serviceable.ts`). Example-based tests pin down concrete corners
 * (square containment, boundary rule, validation, normalisation, the gate's
 * decision table); the property tests assert INVARIANTS — a trivial bounds-check
 * oracle for axis-aligned rectangles, translation invariance, and that closing
 * a ring never changes anything observable. Everything is PURE: no DB, no
 * network.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  isValidPolygon,
  pointInPolygon,
  normalizePolygon,
  type GeoPolygon,
} from '@/lib/routing/service-area';
import { isServiceable } from '@/lib/routing/serviceable';
import type { LatLng } from '@/lib/routing/geo';

/** Build an axis-aligned rectangle polygon (open ring) from lng/lat bounds. */
function rect(lngMin: number, latMin: number, lngMax: number, latMax: number): GeoPolygon {
  return {
    type: 'Polygon',
    // [lng, lat] positions, counter-clockwise, OPEN (not explicitly closed).
    coordinates: [
      [
        [lngMin, latMin],
        [lngMax, latMin],
        [lngMax, latMax],
        [lngMin, latMax],
      ],
    ],
  };
}

/** A simple 0..10 × 0..10 square used by the example-based tests. */
const SQUARE = rect(0, 0, 10, 10);

// ===========================================================================
// Example-based (unit) tests
// ===========================================================================

describe('pointInPolygon — square examples (§10.4)', () => {
  it('point clearly inside → true', () => {
    expect(pointInPolygon({ lat: 5, lng: 5 }, SQUARE)).toBe(true);
  });

  it('point clearly outside → false', () => {
    expect(pointInPolygon({ lat: 20, lng: 20 }, SQUARE)).toBe(false);
  });

  it('point on a vertex → inside (true)', () => {
    expect(pointInPolygon({ lat: 0, lng: 0 }, SQUARE)).toBe(true);
  });

  it('point on an edge midpoint → inside (true)', () => {
    expect(pointInPolygon({ lat: 0, lng: 5 }, SQUARE)).toBe(true);
  });

  it('point just outside an edge → false', () => {
    expect(pointInPolygon({ lat: -0.0001, lng: 5 }, SQUARE)).toBe(false);
  });
});

describe('isValidPolygon (§10.4)', () => {
  it('rejects non-objects', () => {
    expect(isValidPolygon(null)).toBe(false);
    expect(isValidPolygon(undefined)).toBe(false);
    expect(isValidPolygon('Polygon')).toBe(false);
    expect(isValidPolygon(42)).toBe(false);
  });

  it('rejects the wrong type tag', () => {
    expect(isValidPolygon({ type: 'LineString', coordinates: SQUARE.coordinates })).toBe(false);
  });

  it('rejects fewer than 3 positions', () => {
    expect(
      isValidPolygon({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      })
    ).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(
      isValidPolygon({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [200, 0], // lng > 180
            [10, 10],
          ],
        ],
      })
    ).toBe(false);
  });

  it('rejects NaN coordinates', () => {
    expect(
      isValidPolygon({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [NaN, 0],
            [10, 10],
          ],
        ],
      })
    ).toBe(false);
  });

  it('accepts a valid open ring', () => {
    expect(isValidPolygon(SQUARE)).toBe(true);
  });

  it('accepts a valid explicitly-closed ring', () => {
    expect(isValidPolygon(normalizePolygon(SQUARE))).toBe(true);
  });
});

describe('normalizePolygon (§10.4)', () => {
  it('closes an open ring (repeats the first position)', () => {
    const closed = normalizePolygon(SQUARE);
    const ring = closed.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBe(SQUARE.coordinates[0].length + 1);
  });

  it('leaves an already-closed ring unchanged in length', () => {
    const once = normalizePolygon(SQUARE);
    const twice = normalizePolygon(once);
    expect(twice.coordinates[0].length).toBe(once.coordinates[0].length);
    expect(twice.coordinates[0]).toEqual(once.coordinates[0]);
  });
});

describe('isServiceable — decision table (§10.4)', () => {
  it('polygon defined + point inside → true', () => {
    expect(
      isServiceable({ point: { lat: 5, lng: 5 }, polygon: SQUARE, fromBaseKm: 999, serviceRadiusKm: 1 })
    ).toBe(true);
  });

  it('polygon defined + point outside → false (radius ignored)', () => {
    expect(
      isServiceable({ point: { lat: 50, lng: 50 }, polygon: SQUARE, fromBaseKm: 0, serviceRadiusKm: 1000 })
    ).toBe(false);
  });

  it('polygon defined + null point → false (conservative)', () => {
    expect(
      isServiceable({ point: null, polygon: SQUARE, fromBaseKm: 0, serviceRadiusKm: 1000 })
    ).toBe(false);
  });

  it('no polygon + fromBaseKm within radius → true', () => {
    expect(
      isServiceable({ point: null, polygon: null, fromBaseKm: 5, serviceRadiusKm: 10 })
    ).toBe(true);
  });

  it('no polygon + fromBaseKm beyond radius → false', () => {
    expect(
      isServiceable({ point: null, polygon: null, fromBaseKm: 15, serviceRadiusKm: 10 })
    ).toBe(false);
  });

  it('no polygon + null fromBaseKm → true (unknown distance, no block)', () => {
    expect(
      isServiceable({ point: null, polygon: undefined, fromBaseKm: null, serviceRadiusKm: 10 })
    ).toBe(true);
  });
});

// ===========================================================================
// Property-based tests — assert invariants, not reimplementations
// ===========================================================================

/** Minimum rectangle dimension so the oracle avoids degenerate zero-area shapes. */
const MIN_DIM = 0.5;

/**
 * Generator for a non-degenerate axis-aligned rectangle, bounded well inside
 * valid lng/lat ranges so translation stays in range too. Returns the polygon
 * plus its bounds for the trivial oracle.
 */
const rectArb = fc
  .record({
    lngMin: fc.double({ min: -150, max: 100, noNaN: true }),
    latMin: fc.double({ min: -70, max: 60, noNaN: true }),
    w: fc.double({ min: MIN_DIM, max: 40, noNaN: true }),
    h: fc.double({ min: MIN_DIM, max: 20, noNaN: true }),
  })
  .map(({ lngMin, latMin, w, h }) => {
    const lngMax = lngMin + w;
    const latMax = latMin + h;
    return { poly: rect(lngMin, latMin, lngMax, latMax), lngMin, latMin, lngMax, latMax };
  });

// Boundary tolerance matching pointInPolygon's documented edge epsilon: points
// within this distance of an edge resolve to INSIDE and are intentionally not
// asserted by the strict bounds oracle (they live in the ambiguous band).
const BOUNDARY_EPS = 1e-6;

describe('pointInPolygon — rectangle oracle property (§10.4)', () => {
  it('agrees with the trivial bounds check (boundary = inside)', () => {
    fc.assert(
      fc.property(
        rectArb,
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        ({ poly, lngMin, latMin, lngMax, latMax }, lng, lat) => {
          // Skip points sitting within epsilon of any edge: the implementation's
          // boundary rule treats them as inside, so a strict `>=`/`<=` oracle
          // would disagree on points a sub-nanometre outside. Those are covered
          // by the explicit boundary unit tests instead.
          const nearEdge =
            Math.abs(lng - lngMin) < BOUNDARY_EPS ||
            Math.abs(lng - lngMax) < BOUNDARY_EPS ||
            Math.abs(lat - latMin) < BOUNDARY_EPS ||
            Math.abs(lat - latMax) < BOUNDARY_EPS;
          fc.pre(!nearEdge);

          const expected = lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax;
          expect(pointInPolygon({ lat, lng }, poly)).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('agrees with the oracle for points biased onto edges and corners', () => {
    fc.assert(
      fc.property(
        rectArb,
        // Pick a point near/on the rectangle: corners, edge midpoints, centre.
        fc.integer({ min: 0, max: 8 }),
        ({ poly, lngMin, latMin, lngMax, latMax }, which) => {
          const midLng = (lngMin + lngMax) / 2;
          const midLat = (latMin + latMax) / 2;
          const candidates: LatLng[] = [
            { lat: latMin, lng: lngMin }, // corner
            { lat: latMin, lng: lngMax }, // corner
            { lat: latMax, lng: lngMin }, // corner
            { lat: latMax, lng: lngMax }, // corner
            { lat: latMin, lng: midLng }, // bottom edge mid
            { lat: latMax, lng: midLng }, // top edge mid
            { lat: midLat, lng: lngMin }, // left edge mid
            { lat: midLat, lng: lngMax }, // right edge mid
            { lat: midLat, lng: midLng }, // centre
          ];
          const p = candidates[which];
          const expected =
            p.lng >= lngMin && p.lng <= lngMax && p.lat >= latMin && p.lat <= latMax;
          expect(pointInPolygon(p, poly)).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('pointInPolygon — translation invariance (§10.4)', () => {
  it('translating polygon and point by the same offset preserves containment', () => {
    fc.assert(
      fc.property(
        rectArb,
        fc.double({ min: -150, max: 100, noNaN: true }), // point lng seed
        fc.double({ min: -70, max: 60, noNaN: true }), // point lat seed
        fc.double({ min: -15, max: 15, noNaN: true }), // dlng
        fc.double({ min: -10, max: 10, noNaN: true }), // dlat
        ({ poly, lngMin, latMin, lngMax, latMax }, lngSeed, latSeed, dlng, dlat) => {
          // A point somewhere in a generous band around the rectangle.
          const lng = lngMin + (lngMax - lngMin) * ((lngSeed % 2) + 0.5);
          const lat = latMin + (latMax - latMin) * ((latSeed % 2) + 0.5);
          const point: LatLng = { lat, lng };

          const before = pointInPolygon(point, poly);

          const movedPoly: GeoPolygon = {
            type: 'Polygon',
            coordinates: poly.coordinates.map((ring) =>
              ring.map(([x, y]) => [x + dlng, y + dlat])
            ),
          };
          const movedPoint: LatLng = { lat: lat + dlat, lng: lng + dlng };
          const after = pointInPolygon(movedPoint, movedPoly);

          expect(after).toBe(before);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('normalizePolygon — invariants (§10.4)', () => {
  it('isValidPolygon(normalizePolygon(poly)) is always true for a valid polygon', () => {
    fc.assert(
      fc.property(rectArb, ({ poly }) => {
        expect(isValidPolygon(normalizePolygon(poly))).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('closing the ring never changes containment', () => {
    fc.assert(
      fc.property(
        rectArb,
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        ({ poly }, lng, lat) => {
          const p: LatLng = { lat, lng };
          expect(pointInPolygon(p, normalizePolygon(poly))).toBe(pointInPolygon(p, poly));
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('pointInPolygon — determinism (§10.4)', () => {
  it('calling twice yields the same result', () => {
    fc.assert(
      fc.property(
        rectArb,
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        ({ poly }, lng, lat) => {
          const p: LatLng = { lat, lng };
          expect(pointInPolygon(p, poly)).toBe(pointInPolygon(p, poly));
        }
      ),
      { numRuns: 200 }
    );
  });
});
