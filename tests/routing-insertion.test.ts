/**
 * Order Radar — routing insertion & scoring unit tests (Master Spec §10.7).
 *
 * Exactly the four insertion cases the spec calls for, plus a small labelling
 * check. Everything is PURE: a deterministic stub {@link TravelProvider}
 * supplies minutes/km so there is no DB, Redis, or network.
 *
 *   1. Empty day → extraDriveMin === round(2 * toCand).
 *   2. Between two stops → extra === round(toCand + fromCand − direct).
 *   3. Overlap / buffer violations → evaluateInsertion returns null.
 *   4. Sliver penalty applies for a 20-minute gap (score − 25 when 0<gap<30).
 */
import { describe, expect, it } from 'vitest';
import { evaluateInsertion, type Stop } from '@/lib/routing/insertion';
import { scoreInsertion, labelForScore, ROUTING_WEIGHTS } from '@/lib/routing/scoring';
import type { LatLng, TravelProvider } from '@/lib/routing/geo';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A day window: 09:00–17:00 on an arbitrary epoch day. */
const DAY_START = new Date('2024-01-01T09:00:00.000Z').getTime();
const DAY_END = new Date('2024-01-01T17:00:00.000Z').getTime();
const dayWindow = { startMs: DAY_START, endMs: DAY_END };

const base: LatLng = { lat: 0, lng: 0 };

/**
 * A deterministic stub provider driven by a lookup of `minutes`/`km` keyed by a
 * point's `lat` (we encode identity in lat so pairs are predictable). Falls
 * back to a fixed value when a pair isn't in the table.
 */
function stubProvider(opts: {
  minutes: (a: LatLng, b: LatLng) => number;
  km?: (a: LatLng, b: LatLng) => number;
}): TravelProvider {
  return {
    async minutes(a, b) {
      return opts.minutes(a, b);
    },
    async km(a, b) {
      return opts.km ? opts.km(a, b) : 1;
    },
  };
}

describe('evaluateInsertion (§10.3)', () => {
  it('empty day → extraDriveMin === round(2 * toCand)', async () => {
    // Every leg from base costs 10 min; day is empty so round trip = 2*10.
    const tp = stubProvider({ minutes: () => 10 });
    const cand = { loc: { lat: 1, lng: 1 }, startMs: DAY_START + 2 * HOUR, endMs: DAY_START + 3 * HOUR };

    const result = await evaluateInsertion([], base, cand, { bufferMin: 10 }, tp, dayWindow);

    expect(result).not.toBeNull();
    expect(result!.extraDriveMin).toBe(Math.round(2 * 10));
    expect(result!.prevId).toBeNull();
    expect(result!.nextId).toBeNull();
    expect(result!.gapAfterMin).toBeNull(); // no next stop
  });

  it('between two stops → extra === round(toCand + fromCand − direct)', async () => {
    const A: LatLng = { lat: 10, lng: 0 }; // prev stop location
    const B: LatLng = { lat: 20, lng: 0 }; // next stop location
    const C: LatLng = { lat: 15, lng: 0 }; // candidate location

    const toCand = 12; // A -> C
    const fromCand = 9; // C -> B
    const direct = 15; // A -> B

    const tp = stubProvider({
      minutes: (a, b) => {
        if (a.lat === A.lat && b.lat === C.lat) return toCand;
        if (a.lat === C.lat && b.lat === B.lat) return fromCand;
        if (a.lat === A.lat && b.lat === B.lat) return direct;
        return 0;
      },
    });

    const stops: Stop[] = [
      { id: 'prev', loc: A, startMs: DAY_START, endMs: DAY_START + HOUR },
      { id: 'next', loc: B, startMs: DAY_START + 5 * HOUR, endMs: DAY_START + 6 * HOUR },
    ];
    // Candidate sits comfortably between them (large gaps → feasible).
    const cand = { loc: C, startMs: DAY_START + 2 * HOUR, endMs: DAY_START + 3 * HOUR };

    const result = await evaluateInsertion(stops, base, cand, { bufferMin: 10 }, tp, dayWindow);

    expect(result).not.toBeNull();
    expect(result!.extraDriveMin).toBe(Math.round(toCand + fromCand - direct));
    expect(result!.prevId).toBe('prev');
    expect(result!.nextId).toBe('next');
  });

  it('overlap → returns null', async () => {
    const tp = stubProvider({ minutes: () => 5 });
    const existing: Stop = {
      id: 'x',
      loc: { lat: 5, lng: 0 },
      startMs: DAY_START + 2 * HOUR,
      endMs: DAY_START + 3 * HOUR,
    };
    // Candidate overlaps the existing stop's time directly.
    const cand = {
      loc: { lat: 6, lng: 0 },
      startMs: DAY_START + 2 * HOUR + 30 * MIN,
      endMs: DAY_START + 3 * HOUR + 30 * MIN,
    };

    const result = await evaluateInsertion([existing], base, cand, { bufferMin: 10 }, tp, dayWindow);
    expect(result).toBeNull();
  });

  it('buffer violation (too close to an adjacent stop) → returns null', async () => {
    const tp = stubProvider({ minutes: () => 5 });
    const existing: Stop = {
      id: 'x',
      loc: { lat: 5, lng: 0 },
      startMs: DAY_START + 2 * HOUR,
      endMs: DAY_START + 3 * HOUR,
    };
    // Candidate ends only 5 min before the existing stop starts — inside the
    // 10-min buffer, so the buffer-aware overlap check rejects it.
    const cand = {
      loc: { lat: 6, lng: 0 },
      startMs: DAY_START + 1 * HOUR,
      endMs: DAY_START + 2 * HOUR - 5 * MIN,
    };

    const result = await evaluateInsertion([existing], base, cand, { bufferMin: 10 }, tp, dayWindow);
    expect(result).toBeNull();
  });
});

describe('scoreInsertion sliver penalty (§10.4)', () => {
  it('subtracts 25 for a 20-minute gap after the slot', async () => {
    const A: LatLng = { lat: 10, lng: 0 };
    const B: LatLng = { lat: 20, lng: 0 };
    const C: LatLng = { lat: 15, lng: 0 };

    // fromCand small so gapAfterMin lands at ~20 min (a sliver).
    const toCand = 5;
    const fromCand = 5;
    const direct = 8;

    const tp = stubProvider({
      minutes: (a, b) => {
        if (a.lat === A.lat && b.lat === C.lat) return toCand;
        if (a.lat === C.lat && b.lat === B.lat) return fromCand;
        if (a.lat === A.lat && b.lat === B.lat) return direct;
        return 0;
      },
      km: () => 10, // fromPrevKm = 10 → no close-prev bonus, isolates the sliver effect
    });

    // next starts 25 min after cand ends; gapAfterMin = 25 - fromCand(5) = 20.
    const stops: Stop[] = [
      { id: 'prev', loc: A, startMs: DAY_START, endMs: DAY_START + HOUR },
      {
        id: 'next',
        loc: B,
        startMs: DAY_START + 2 * HOUR + 25 * MIN,
        endMs: DAY_START + 3 * HOUR,
      },
    ];
    const cand = { loc: C, startMs: DAY_START + HOUR + 30 * MIN, endMs: DAY_START + 2 * HOUR };

    const result = await evaluateInsertion(stops, base, cand, { bufferMin: 10 }, tp, dayWindow);
    expect(result).not.toBeNull();
    expect(result!.gapAfterMin).toBe(20); // sliver range 0<gap<30

    const withSliver = scoreInsertion(result!, { clusterDay: false });

    // The same result but pretending the gap is outside the sliver range: the
    // score should be exactly SLIVER_PENALTY higher (minus the small per-min gap
    // term difference we neutralise by comparing the flat penalty only).
    const noSliver = scoreInsertion({ ...result!, gapAfterMin: 40 }, { clusterDay: false });

    // noSliver has NO 25-point penalty; withSliver has it. Difference ≈ 25
    // (± the 0.15/min gap term which we account for).
    const gapTermDiff =
      ROUTING_WEIGHTS.GAP_PER_MIN * (Math.min(40, 120) - Math.min(20, 120)); // 0.15*(40-20)=3
    // withSliver = base - drive - 25 - 0.15*20 ; noSliver = base - drive - 0.15*40
    // noSliver - withSliver = 25 - 3  = 22  (rounding aside)
    expect(noSliver - withSliver).toBe(Math.round(ROUTING_WEIGHTS.SLIVER_PENALTY - gapTermDiff));
  });
});

describe('labelForScore thresholds (§10.4)', () => {
  it('score >= 80 → "Best fit"', () => {
    expect(labelForScore(80, 30)).toBe('Best fit');
    expect(labelForScore(95, 100)).toBe('Best fit');
  });

  it('score < 80 but extraDriveMin <= 8 → "Nearby stop"', () => {
    expect(labelForScore(50, 8)).toBe('Nearby stop');
    expect(labelForScore(79, 0)).toBe('Nearby stop');
  });

  it('otherwise → null', () => {
    expect(labelForScore(50, 20)).toBeNull();
    expect(labelForScore(10, 9)).toBeNull();
  });
});
