/**
 * Slot scoring, labelling, hard filters and travel fees (Master Spec §10.4).
 *
 * Turns an {@link InsertionResult} into a 0..100 route-fit score, a human label
 * ("Best fit" / "Nearby stop"), and provides the hard filters (service radius,
 * max detour) plus travel-fee tier lookup. All pure and DB-free.
 *
 * _Master Spec: §10.4_
 */
import type { InsertionResult } from '@/lib/routing/insertion';

/**
 * Every magic number for scoring lives here so the model can be tuned in one
 * place (Master Spec §10.4).
 */
export const ROUTING_WEIGHTS = {
  /** Starting score before penalties/bonuses. */
  BASE: 100,
  /** Penalty per extra driving minute. */
  EXTRA_DRIVE_PER_MIN: 1.6,
  /** Flat penalty for an unusable sliver gap (0 < gap < SLIVER_MAX_MIN). */
  SLIVER_PENALTY: 25,
  /** Upper bound (exclusive) of what counts as a sliver gap, in minutes. */
  SLIVER_MAX_MIN: 30,
  /** Mild packing preference: per-minute penalty on the (capped) gap after. */
  GAP_PER_MIN: 0.15,
  /** Cap applied to gapAfterMin before the packing penalty, in minutes. */
  GAP_CAP_MIN: 120,
  /** Clustering bonus when the previous stop is very close. */
  CLOSE_PREV_BONUS: 10,
  /** Distance (km) under which the close-prev bonus applies. */
  CLOSE_PREV_KM: 5,
  /** Bonus when the day already clusters (>=2 stops within 8 km). */
  CLUSTER_DAY_BONUS: 6,
  /** Score at/above which a slot earns the "Best fit" label. */
  BEST_FIT_SCORE: 80,
  /** Extra-drive minutes at/under which a slot earns "Nearby stop". */
  NEARBY_MAX_MIN: 8,
} as const;

/** Context the score needs beyond the insertion result itself. */
export interface ScoreContext {
  /** True when the day already has >= 2 stops within 8 km of each other. */
  clusterDay: boolean;
}

/**
 * Score an insertion 0..100 (higher = better route fit). Master Spec §10.4:
 *
 *   score = 100
 *     − 1.6 * extraDriveMin
 *     − 25 if 0 < gapAfterMin < 30
 *     − 0.15 * min(gapAfterMin, 120)
 *     + 10 if fromPrevKm <= 5
 *     + 6  if clusterDay
 *   clamp to 0..100
 */
export function scoreInsertion(result: InsertionResult, ctx: ScoreContext): number {
  const W = ROUTING_WEIGHTS;
  let score = W.BASE;

  score -= W.EXTRA_DRIVE_PER_MIN * result.extraDriveMin;

  const gap = result.gapAfterMin;
  if (gap != null) {
    if (gap > 0 && gap < W.SLIVER_MAX_MIN) score -= W.SLIVER_PENALTY;
    score -= W.GAP_PER_MIN * Math.min(gap, W.GAP_CAP_MIN);
  }

  if (result.fromPrevKm <= W.CLOSE_PREV_KM) score += W.CLOSE_PREV_BONUS;
  if (ctx.clusterDay) score += W.CLUSTER_DAY_BONUS;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Human-facing label for a scored slot. Master Spec §10.4:
 *   score >= 80 → "Best fit"; else extraDriveMin <= 8 → "Nearby stop"; else null.
 */
export function labelForScore(score: number, extraDriveMin: number): string | null {
  if (score >= ROUTING_WEIGHTS.BEST_FIT_SCORE) return 'Best fit';
  if (extraDriveMin <= ROUTING_WEIGHTS.NEARBY_MAX_MIN) return 'Nearby stop';
  return null;
}

// ---------------------------------------------------------------------------
// Hard filters (§10.4). Outside service radius → not bookable; over max detour
// → hidden from clients (still shown to the groomer when adding manually).
// ---------------------------------------------------------------------------

/**
 * Whether a stop `fromBaseKm` away is within the groomer's service radius.
 * A missing/undefined radius means "no limit" → always within.
 */
export function isWithinServiceRadius(
  fromBaseKm: number,
  serviceRadiusKm: number | undefined | null
): boolean {
  if (serviceRadiusKm == null || serviceRadiusKm <= 0) return true;
  return fromBaseKm <= serviceRadiusKm;
}

/**
 * Whether the insertion's extra driving exceeds the groomer's max detour.
 * A missing/undefined max means "no limit" → never exceeds.
 */
export function exceedsMaxDetour(
  extraDriveMin: number,
  maxDetourMin: number | undefined | null
): boolean {
  if (maxDetourMin == null || maxDetourMin <= 0) return false;
  return extraDriveMin > maxDetourMin;
}

// ---------------------------------------------------------------------------
// Travel fee tiers (§10.4). Add to the estimate shown in booking step 3.
// ---------------------------------------------------------------------------

/** A travel-fee tier: charge `fee` for distances up to `uptoKm`. */
export interface TravelFeeTier {
  uptoKm: number;
  fee: number;
}

/**
 * Look up the travel fee for a stop `fromBaseKm` away. Tiers are matched by the
 * smallest `uptoKm` that still covers the distance; if none match (distance
 * beyond every tier, or no tiers configured), the fee is 0.
 */
export function travelFeeFor(fromBaseKm: number, tiers: TravelFeeTier[] | undefined | null): number {
  if (!tiers || tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.uptoKm - b.uptoKm);
  const match = sorted.find((t) => fromBaseKm <= t.uptoKm);
  return match ? match.fee : 0;
}
