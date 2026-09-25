/**
 * Pure calendar-grid geometry helpers (Master Spec §9.6).
 *
 * The portal calendar renders appointment blocks on a 15-minute grid and
 * translates drag/resize gestures back into snapped epoch-ms times. Keeping the
 * math here — DB-free, clock-free, deterministic — lets the calendar UI stay
 * thin and lets these rules be unit-tested directly.
 *
 * Conventions:
 *  - `SLOT_STEP_MIN` is the snap granularity (15 minutes).
 *  - The visible day runs from `DAY_START_HOUR` to `DAY_END_HOUR` (local time
 *    of the provided Date). Positions are expressed as minutes-from-day-start
 *    and, given a pixels-per-minute scale, as pixels.
 */

export const SLOT_STEP_MIN = 15;
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 21;
export const MS_PER_MINUTE = 60 * 1000;

/** Total minutes shown in a day column/timeline. */
export const VISIBLE_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

/**
 * Snap an epoch-ms instant to the nearest `stepMin` boundary, anchored to the
 * start of that instant's local day. Rounds to nearest (so a small drag settles
 * onto the closest grid line).
 */
export function snapToStep(ms: number, stepMin = SLOT_STEP_MIN): number {
  const stepMs = stepMin * MS_PER_MINUTE;
  const d = new Date(ms);
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  const offset = ms - dayStart.getTime();
  const snappedOffset = Math.round(offset / stepMs) * stepMs;
  return dayStart.getTime() + snappedOffset;
}

/**
 * Minutes from the visible day start (DAY_START_HOUR) for an epoch-ms instant,
 * in that instant's local timezone. Values before the visible window are
 * negative; after it, greater than VISIBLE_MINUTES.
 */
export function minutesFromDayStart(ms: number): number {
  const d = new Date(ms);
  return (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
}

/** Duration between two epoch-ms instants, in whole minutes (>= 0). */
export function durationMinutes(startMs: number, endMs: number): number {
  return Math.max(0, Math.round((endMs - startMs) / MS_PER_MINUTE));
}

/**
 * Translate a vertical pixel delta into a snapped minute delta given the grid
 * scale (pixels per minute). Used for drag-move and resize gestures.
 */
export function pixelsToSnappedMinutes(
  deltaPx: number,
  pxPerMinute: number,
  stepMin = SLOT_STEP_MIN
): number {
  if (pxPerMinute <= 0) return 0;
  const rawMin = deltaPx / pxPerMinute;
  return Math.round(rawMin / stepMin) * stepMin;
}

/**
 * Given a block's original start/end (epoch ms) and a snapped minute delta,
 * return the moved start/end preserving duration. Used for drag-to-move.
 */
export function shiftBlock(
  startMs: number,
  endMs: number,
  deltaMinutes: number
): { startMs: number; endMs: number } {
  const deltaMs = deltaMinutes * MS_PER_MINUTE;
  return { startMs: startMs + deltaMs, endMs: endMs + deltaMs };
}

/**
 * Given a block's start/end and a snapped minute delta applied to the END edge,
 * return the resized block. The end is clamped so the block keeps at least one
 * `stepMin` of duration (a block can never be zero/negative length).
 */
export function resizeBlockEnd(
  startMs: number,
  endMs: number,
  deltaMinutes: number,
  stepMin = SLOT_STEP_MIN
): { startMs: number; endMs: number } {
  const minEnd = startMs + stepMin * MS_PER_MINUTE;
  const proposed = endMs + deltaMinutes * MS_PER_MINUTE;
  return { startMs, endMs: Math.max(minEnd, proposed) };
}

/** Local `yyyy-mm-dd` key for grouping appointments by day. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
