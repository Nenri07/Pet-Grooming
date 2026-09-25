/**
 * Fill My Day — candidate ranking (Master Spec §11.1) — PURE.
 *
 * When a gap opens (a cancellation, or the groomer taps "Fill this gap"), we
 * gather potential clients — active waitlist entries and clients whose pet is
 * due soon — and rank them by how well the gap fits into that day's route.
 *
 * {@link findGapCandidates} is a PURE function: it takes the gap, the candidate
 * pool, the day's existing stops, the groomer base, and a routing config +
 * travel provider, and returns the feasible candidates ranked best-first. It
 * has NO DB / Redis / SMS dependency, so the orchestrator (`fill.ts`) does all
 * the I/O and hands clean data here. That keeps this testable with literals.
 *
 * A candidate is dropped when:
 *   - they have opted out of SMS (`smsOptOut`) — never offer them the slot;
 *   - they have no known location (can't route them into the gap);
 *   - {@link evaluateInsertion} finds the insertion infeasible (overlap / can't
 *     make the drive in time).
 *
 * Feasible candidates are scored with {@link scoreInsertion} (same model Order
 * Radar uses) and sorted by score descending.
 *
 * _Master Spec: §11.1, §10.3, §10.4_
 */
import type { LatLng, TravelProvider } from '@/lib/routing/geo';
import { evaluateInsertion, type Cfg, type Stop } from '@/lib/routing/insertion';
import { scoreInsertion } from '@/lib/routing/scoring';
import { haversineKm } from '@/lib/routing/geo';
import { ROUTING } from '@/lib/routing';

/** The freed interval to fill, in epoch ms. */
export interface Gap {
  startMs: number;
  endMs: number;
}

/** A potential client to offer the gap to. */
export interface FillCandidate {
  /** Client id. */
  clientId: string;
  /** Client display name (for SMS + logging). */
  name?: string;
  /** Destination phone (E.164 preferred). */
  phone?: string;
  /** Geocoded service-address coordinates; absent → dropped. */
  location?: LatLng | null;
  /** Whether the client has opted out of SMS (STOP); true → dropped. */
  smsOptOut?: boolean | null;
  /** Pet id, when this candidate came from a due-pet (for prefill/logging). */
  petId?: string;
  /** Origin of the candidate (waitlist vs a due pet), for downstream context. */
  origin: 'waitlist' | 'due';
}

/** A ranked, feasible candidate ready to be offered. */
export interface RankedCandidate extends FillCandidate {
  /** Route-fit score 0..100 (higher = better). */
  score: number;
  /** Extra driving minutes this insertion adds. */
  extraDriveMin: number;
  /** Distance from the previous stop, km. */
  fromPrevKm: number;
}

/** Everything {@link findGapCandidates} needs (all pure / injectable). */
export interface FindGapCandidatesInput {
  gap: Gap;
  candidates: FillCandidate[];
  /** The day's existing non-cancelled stops (for insertion evaluation). */
  existingStops: Stop[];
  /** Groomer base location (start/end of day). */
  base: LatLng;
  /** Routing config (buffer/overtime). */
  cfg: Cfg;
  /** Travel provider (haversine by default; stub in tests). */
  tp: TravelProvider;
  /** Working-day bounds in epoch ms (defaults to the gap itself when omitted). */
  dayWindow?: { startMs: number; endMs: number };
}

/**
 * Compute the "cluster day" flag: does the day already have >= 2 stops within
 * the cluster distance of each other (§10.4)?
 */
function computeClusterDay(stops: Stop[]): boolean {
  let close = 0;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (haversineKm(stops[i].loc, stops[j].loc) <= ROUTING.clusterKm) {
        close += 1;
        if (close >= 2) return true;
      }
    }
  }
  return false;
}

/**
 * PURE: rank the candidates who can feasibly take the gap, best route-fit
 * first. Opted-out and location-less candidates are dropped before routing;
 * infeasible insertions are dropped after. See the module docs.
 */
export async function findGapCandidates(
  input: FindGapCandidatesInput
): Promise<RankedCandidate[]> {
  const { gap, candidates, existingStops, base, cfg, tp } = input;
  const dayWindow = input.dayWindow ?? { startMs: gap.startMs, endMs: gap.endMs };

  const clusterDay = computeClusterDay(existingStops);
  const ranked: RankedCandidate[] = [];

  for (const c of candidates) {
    // Drop opted-out clients — never offer them the slot (§11.1, §12.3).
    if (c.smsOptOut) continue;
    // Drop candidates with no known location — cannot route them into the gap.
    if (!c.location) continue;

    const result = await evaluateInsertion(
      existingStops,
      base,
      { loc: c.location, startMs: gap.startMs, endMs: gap.endMs },
      cfg,
      tp,
      dayWindow
    );
    // Infeasible insertion (overlap / drive doesn't fit) → drop.
    if (!result) continue;

    const score = scoreInsertion(result, { clusterDay });
    ranked.push({
      ...c,
      score,
      extraDriveMin: result.extraDriveMin,
      fromPrevKm: result.fromPrevKm,
    });
  }

  // Best route-fit first; tie-break on fewer extra driving minutes.
  ranked.sort((a, b) => b.score - a.score || a.extraDriveMin - b.extraDriveMin);
  return ranked;
}
