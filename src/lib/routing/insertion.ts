/**
 * Insertion evaluation for Order Radar (Master Spec §10.3).
 *
 * Appointments have fixed times, so where a candidate slot lands in the day is
 * fully determined by time — there is no permutation search. We find the stop
 * immediately before and after the candidate, verify no overlap (buffer-aware)
 * and that the drive legs are feasible within the gaps, then report how many
 * EXTRA driving minutes the insertion adds versus driving prev→next directly.
 *
 * PURE relative to its {@link TravelProvider}: pass a deterministic stub in
 * tests and this function needs no DB, Redis, or network.
 *
 * _Master Spec: §10.3_
 */
import type { LatLng, TravelProvider } from '@/lib/routing/geo';

const MS_PER_MINUTE = 60_000;

/** An existing stop on the day (a non-cancelled appointment). */
export interface Stop {
  id: string;
  loc: LatLng;
  startMs: number;
  endMs: number;
}

/** The candidate slot being evaluated for insertion. */
export interface Cand {
  loc: LatLng;
  startMs: number;
  endMs: number;
}

/**
 * Insertion config.
 *
 * The Master Spec body references three fields: `bufferMs` (overlap check),
 * `bufferMin` (feasibility, in minutes) and `overtimeMs` (end-of-day slack).
 * A caller only strictly needs to supply `bufferMin`; `bufferMs` is derived
 * from it and `overtimeMs` defaults to 0 when omitted. Use {@link resolveCfg}
 * so both `bufferMin` and `bufferMs` are always coherent (bufferMs === bufferMin*60000).
 */
export interface Cfg {
  /** Buffer in minutes (authoritative). */
  bufferMin: number;
  /** Buffer in ms. Derived from `bufferMin` when not supplied. */
  bufferMs?: number;
  /** Allowed slack past the day window's end, in ms. Defaults to 0. */
  overtimeMs?: number;
}

/** A fully-resolved config with every field populated + consistent. */
interface ResolvedCfg {
  bufferMin: number;
  bufferMs: number;
  overtimeMs: number;
}

/**
 * Normalise a {@link Cfg} so `bufferMs` and `overtimeMs` are always defined and
 * `bufferMs` is consistent with `bufferMin`. If a caller passes `bufferMs`
 * explicitly it is honoured; otherwise it is `bufferMin * 60000`.
 */
export function resolveCfg(cfg: Cfg): ResolvedCfg {
  return {
    bufferMin: cfg.bufferMin,
    bufferMs: cfg.bufferMs ?? cfg.bufferMin * MS_PER_MINUTE,
    overtimeMs: cfg.overtimeMs ?? 0,
  };
}

/** The outcome of a feasible insertion. `null` means "cannot insert here". */
export interface InsertionResult {
  prevId: string | null;
  nextId: string | null;
  extraDriveMin: number;
  fromPrevKm: number;
  gapAfterMin: number | null;
}

/**
 * Evaluate inserting `cand` into `stops` for a single day.
 *
 * Implements Master Spec §10.3 verbatim: locate prev/next by time, reject on
 * buffer-aware overlap, check drive feasibility into and out of the slot, then
 * compute `extraDriveMin` (round-trip `2*toCand` when the day is empty, else
 * `toCand + fromCand − direct`).
 *
 * @param stops     that day's non-cancelled appointments (order-independent;
 *                  prev/next are found by time).
 * @param base      groomer base location (start/end of day).
 * @param cand      the candidate slot.
 * @param cfg       buffer/overtime config (see {@link Cfg}).
 * @param tp        travel provider (haversine by default; stub in tests).
 * @param dayWindow the working-day bounds in epoch ms.
 * @returns the insertion metrics, or `null` if the slot is infeasible.
 */
export async function evaluateInsertion(
  stops: Stop[],
  base: LatLng,
  cand: Cand,
  cfg: Cfg,
  tp: TravelProvider,
  dayWindow: { startMs: number; endMs: number }
): Promise<InsertionResult | null> {
  const c = resolveCfg(cfg);

  const prev = [...stops].reverse().find((s) => s.endMs <= cand.startMs) ?? null;
  const next = stops.find((s) => s.startMs >= cand.endMs) ?? null;

  // Buffer-aware overlap with ANY existing stop → cannot insert.
  if (
    stops.some(
      (s) => s.startMs < cand.endMs + c.bufferMs && s.endMs + c.bufferMs > cand.startMs
    )
  ) {
    return null;
  }

  const prevLoc = prev?.loc ?? base,
    nextLoc = next?.loc ?? base;
  const toCand = await tp.minutes(prevLoc, cand.loc);
  const fromCand = await tp.minutes(cand.loc, nextLoc);
  const direct = await tp.minutes(prevLoc, nextLoc);

  // Feasibility: driving + buffer must fit the gaps around the slot.
  const earliestArrive =
    (prev ? prev.endMs : dayWindow.startMs) + (toCand + c.bufferMin) * MS_PER_MINUTE;
  if (earliestArrive > cand.startMs) return null;
  if (next && cand.endMs + (fromCand + c.bufferMin) * MS_PER_MINUTE > next.startMs) return null;
  if (!next && cand.endMs + fromCand * MS_PER_MINUTE > dayWindow.endMs + c.overtimeMs) return null;

  // Round-trip when the day is empty; otherwise the marginal detour.
  const extraDriveMin = prev || next ? toCand + fromCand - direct : 2 * toCand;

  return {
    prevId: prev?.id ?? null,
    nextId: next?.id ?? null,
    extraDriveMin: Math.max(0, Math.round(extraDriveMin)),
    fromPrevKm: +(await tp.km(prevLoc, cand.loc)).toFixed(1),
    gapAfterMin: next ? Math.round((next.startMs - cand.endMs) / MS_PER_MINUTE - fromCand) : null,
  };
}
