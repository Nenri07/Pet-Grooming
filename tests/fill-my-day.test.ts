/**
 * Fill My Day + Rebooking autopilot — pure unit tests (Master Spec §11.1, §11.4).
 *
 * These exercise ONLY the pure cores — no DB, Redis, or SMS:
 *   - findGapCandidates: ranks feasible candidates best-first, drops opted-out
 *     and location-less clients, and drops infeasible insertions.
 *   - defaultIntervalWeeks / resolveIntervalWeeks / computeNextDueAt: the coat →
 *     interval mapping and the per-pet override.
 *
 * A deterministic stub TravelProvider supplies minutes/km so the routing math
 * is predictable.
 */
import { describe, expect, it } from 'vitest';
import { findGapCandidates, type FillCandidate } from '@/lib/fill/candidates';
import type { Stop } from '@/lib/routing/insertion';
import type { LatLng, TravelProvider } from '@/lib/routing/geo';
import {
  defaultIntervalWeeks,
  resolveIntervalWeeks,
  computeNextDueAt,
  COAT_INTERVAL_WEEKS,
} from '@/lib/rebooking/interval';

const MIN = 60_000;
const HOUR = 60 * MIN;

const DAY_START = new Date('2024-06-03T09:00:00.000Z').getTime();
const DAY_END = new Date('2024-06-03T17:00:00.000Z').getTime();
const dayWindow = { startMs: DAY_START, endMs: DAY_END };

const base: LatLng = { lat: 0, lng: 0 };

/** The gap to fill: 12:00–13:00. */
const gap = { startMs: DAY_START + 3 * HOUR, endMs: DAY_START + 4 * HOUR };

/**
 * Deterministic travel stub: minutes proportional to |lat| distance so a
 * candidate encoded with a smaller lat is "closer" and scores higher.
 */
function stubProvider(perLatMinutes = 5): TravelProvider {
  return {
    async minutes(a, b) {
      return Math.abs(a.lat - b.lat) * perLatMinutes + 2;
    },
    async km(a, b) {
      return Math.abs(a.lat - b.lat);
    },
  };
}

/** A base candidate with sensible defaults, overridable per case. */
function candidate(over: Partial<FillCandidate> & { clientId: string }): FillCandidate {
  return {
    name: `Client ${over.clientId}`,
    phone: '+15555550100',
    location: { lat: 1, lng: 1 },
    smsOptOut: false,
    origin: 'waitlist',
    ...over,
  };
}

describe('findGapCandidates (§11.1)', () => {
  it('ranks feasible candidates best route-fit first', async () => {
    const tp = stubProvider();
    // No existing stops → empty day; closer candidate (smaller lat) wins.
    const candidates: FillCandidate[] = [
      candidate({ clientId: 'far', location: { lat: 5, lng: 5 } }),
      candidate({ clientId: 'near', location: { lat: 1, lng: 1 } }),
    ];

    const ranked = await findGapCandidates({
      gap,
      candidates,
      existingStops: [],
      base,
      cfg: { bufferMin: 10 },
      tp,
      dayWindow,
    });

    expect(ranked.map((r) => r.clientId)).toEqual(['near', 'far']);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    // Scores are within the valid range.
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('drops SMS opt-outs and location-less candidates', async () => {
    const tp = stubProvider();
    const candidates: FillCandidate[] = [
      candidate({ clientId: 'ok' }),
      candidate({ clientId: 'optedout', smsOptOut: true }),
      candidate({ clientId: 'noloc', location: null }),
    ];

    const ranked = await findGapCandidates({
      gap,
      candidates,
      existingStops: [],
      base,
      cfg: { bufferMin: 10 },
      tp,
      dayWindow,
    });

    const ids = ranked.map((r) => r.clientId);
    expect(ids).toContain('ok');
    expect(ids).not.toContain('optedout');
    expect(ids).not.toContain('noloc');
  });

  it('drops candidates whose insertion is infeasible (buffer overlap)', async () => {
    const tp = stubProvider();
    // An existing stop that overlaps the gap window (buffer-aware) makes the
    // insertion infeasible, so the candidate is dropped.
    const overlapping: Stop[] = [
      {
        id: 'existing',
        loc: { lat: 1, lng: 1 },
        startMs: gap.startMs - 5 * MIN,
        endMs: gap.startMs + 30 * MIN,
      },
    ];

    const ranked = await findGapCandidates({
      gap,
      candidates: [candidate({ clientId: 'blocked' })],
      existingStops: overlapping,
      base,
      cfg: { bufferMin: 10 },
      tp,
      dayWindow,
    });

    expect(ranked).toHaveLength(0);
  });
});

describe('defaultIntervalWeeks (§11.4)', () => {
  it('maps each coat to its default interval in weeks', () => {
    expect(defaultIntervalWeeks('smooth')).toBe(6);
    expect(defaultIntervalWeeks('double')).toBe(8);
    expect(defaultIntervalWeeks('wire')).toBe(6);
    expect(defaultIntervalWeeks('curly')).toBe(5);
    expect(defaultIntervalWeeks('long')).toBe(5);
    expect(defaultIntervalWeeks('matted')).toBe(4);
    // The map matches the spec exactly.
    expect(COAT_INTERVAL_WEEKS).toEqual({
      smooth: 6,
      double: 8,
      wire: 6,
      curly: 5,
      long: 5,
      matted: 4,
    });
  });

  it('falls back for unknown / missing coats', () => {
    expect(defaultIntervalWeeks(undefined)).toBe(6);
    expect(defaultIntervalWeeks(null)).toBe(6);
    expect(defaultIntervalWeeks('unknown-coat')).toBe(6);
  });

  it('per-pet override wins over the coat default', () => {
    // matted default is 4; override to 3.
    expect(resolveIntervalWeeks('matted', 3)).toBe(3);
    // Invalid overrides fall back to the coat default.
    expect(resolveIntervalWeeks('matted', 0)).toBe(4);
    expect(resolveIntervalWeeks('matted', -1)).toBe(4);
    expect(resolveIntervalWeeks('matted', undefined)).toBe(4);
  });

  it('computeNextDueAt adds the resolved interval to lastGroomAt', () => {
    const last = new Date('2024-01-01T00:00:00.000Z');
    // double = 8 weeks = 56 days.
    const next = computeNextDueAt(last, 'double', undefined);
    const expected = new Date(last.getTime() + 8 * 7 * 24 * 60 * 60 * 1000);
    expect(next.getTime()).toBe(expected.getTime());

    // Override to 2 weeks.
    const overridden = computeNextDueAt(last, 'double', 2);
    expect(overridden.getTime()).toBe(last.getTime() + 2 * 7 * 24 * 60 * 60 * 1000);
  });
});
