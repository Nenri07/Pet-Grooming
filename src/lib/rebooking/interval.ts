/**
 * Rebooking autopilot — coat-based intervals (Master Spec §11.4) — PURE.
 *
 * Different coats need grooming at different cadences. {@link defaultIntervalWeeks}
 * maps a coat to its default interval in weeks; a per-pet override
 * (`rebookIntervalWeeks`) always wins via {@link resolveIntervalWeeks}.
 * {@link computeNextDueAt} turns "last groomed at X" into "next due at X + N
 * weeks". All pure — no DB / Redis / SMS — so it is trivially unit-tested.
 *
 * _Master Spec: §11.4, §14_
 */
import type { CoatCondition } from '@/types';

/** One week in milliseconds. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Fallback interval (weeks) when a coat is unknown / unset. */
const FALLBACK_WEEKS = 6;

/**
 * Default rebooking interval by coat, in weeks (Master Spec §11.4):
 *   smooth 6, double 8, wire 6, curly 5, long 5, matted 4.
 */
export const COAT_INTERVAL_WEEKS: Record<CoatCondition, number> = {
  smooth: 6,
  double: 8,
  wire: 6,
  curly: 5,
  long: 5,
  matted: 4,
};

/**
 * PURE: the default rebooking interval (weeks) for a coat. Unknown / undefined
 * coats fall back to {@link FALLBACK_WEEKS}.
 */
export function defaultIntervalWeeks(coat: CoatCondition | string | null | undefined): number {
  if (coat && coat in COAT_INTERVAL_WEEKS) {
    return COAT_INTERVAL_WEEKS[coat as CoatCondition];
  }
  return FALLBACK_WEEKS;
}

/**
 * PURE: resolve the effective interval (weeks) — a positive per-pet override
 * wins over the coat default.
 */
export function resolveIntervalWeeks(
  coat: CoatCondition | string | null | undefined,
  override: number | null | undefined
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return override;
  }
  return defaultIntervalWeeks(coat);
}

/**
 * PURE: compute when a pet is next due, given when it was last groomed, its
 * coat, and an optional per-pet interval override.
 */
export function computeNextDueAt(
  lastGroomAt: Date,
  coat: CoatCondition | string | null | undefined,
  override: number | null | undefined
): Date {
  const weeks = resolveIntervalWeeks(coat, override);
  return new Date(lastGroomAt.getTime() + weeks * WEEK_MS);
}
