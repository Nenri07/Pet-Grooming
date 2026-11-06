/**
 * PURE slot shaping by plan.
 *
 * Route ranking ("Best fit", added driving) is an Order Radar feature, so only
 * groomers whose entitlements include `orderRadar` may show it. For everyone
 * else the slots go out as a plain, time-ordered list with the route
 * annotations removed.
 *
 * Kept outside the `'use server'` availability action so it can be a sync
 * export and be unit/property tested directly.
 *
 * _Requirements: 1.1, 1.2_
 */

/** The minimal slot shape this helper reads and writes. */
export interface ShapeableSlot {
  start: Date | string;
  label?: string | null;
  extraDriveMin?: number;
}

function startMs(start: Date | string): number {
  return start instanceof Date ? start.getTime() : Date.parse(start);
}

/**
 * Shape a slot list for the groomer's plan.
 *
 * - `routingAllowed: true`  → the input array is returned unchanged.
 * - `routingAllowed: false` → a new array sorted by start time, each slot a
 *   copy with `label` and `extraDriveMin` set to `undefined`.
 */
export function shapeSlotsForPlan<T extends ShapeableSlot>(
  slots: T[],
  { routingAllowed }: { routingAllowed: boolean }
): T[] {
  if (routingAllowed) return slots;
  return slots
    .map((s) => ({ ...s, label: undefined, extraDriveMin: undefined }))
    .sort((a, b) => startMs(a.start) - startMs(b.start));
}
