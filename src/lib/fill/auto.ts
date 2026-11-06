/**
 * Fill My Day auto-start on cancellation (plan-claims-audit, Requirement 3).
 *
 * When a groomer cancels an appointment, the freed slot is offered to
 * candidates automatically, but only when:
 *   - the slot starts more than {@link AUTO_FILL_MIN_LEAD_MS} from now (3.3), and
 *   - the groomer's plan includes `fillMyDay` (Pro / trial).
 *
 * {@link fillMyDay} records a FillEvent per run, so auto runs show up in the
 * dashboard's recovered-revenue totals with no extra work (3.5).
 *
 * The DB-backed modules are loaded with dynamic imports so the pure
 * {@link shouldAutoFill} stays importable in tests without Mongoose.
 *
 * _Requirements: 3.3, 3.5_
 */

/** Minimum lead time before a cancelled slot is auto-offered: 2 hours. */
export const AUTO_FILL_MIN_LEAD_MS = 2 * 60 * 60 * 1000;

/**
 * PURE: whether a cancelled slot starting at `slotStartMs` should be
 * auto-offered at `nowMs`. True exactly when the slot starts more than
 * 2 hours from now. False for non-finite inputs.
 */
export function shouldAutoFill(slotStartMs: number, nowMs: number): boolean {
  if (!Number.isFinite(slotStartMs) || !Number.isFinite(nowMs)) return false;
  return slotStartMs - nowMs > AUTO_FILL_MIN_LEAD_MS;
}

/**
 * PURE: the time freed by moving an appointment from the old window
 * `[oldStartMs, oldEndMs)` to the new window `[newStartMs, newEndMs)`.
 *
 * Windows are half-open, so touching windows (`oldEnd === newStart` or
 * `newEnd === oldStart`) do not overlap and the whole old window is freed.
 * Returns the old window when the two windows do not overlap at all, and
 * `null` when they overlap (partially or fully, including identical windows):
 * a partial leftover is usually too short to sell. Also `null` for non-finite
 * inputs or an empty/inverted window.
 */
export function freedWindowAfterMove(
  oldStartMs: number,
  oldEndMs: number,
  newStartMs: number,
  newEndMs: number
): { startMs: number; endMs: number } | null {
  if (
    !Number.isFinite(oldStartMs) ||
    !Number.isFinite(oldEndMs) ||
    !Number.isFinite(newStartMs) ||
    !Number.isFinite(newEndMs)
  ) {
    return null;
  }
  if (oldEndMs <= oldStartMs || newEndMs <= newStartMs) return null;
  const overlaps = oldStartMs < newEndMs && newStartMs < oldEndMs;
  if (overlaps) return null;
  return { startMs: oldStartMs, endMs: oldEndMs };
}

/**
 * Start Fill My Day for a cancelled appointment's slot when the plan and the
 * timing allow it. Best-effort: never throws to the caller.
 *
 * @param groomerId The groomer (User id).
 * @param appt The cancelled appointment's start and end.
 * @param now Reference time (injectable; defaults to real now).
 */
export async function autoFillCancelledSlot(
  groomerId: string,
  appt: { scheduledDate: Date | string; scheduledEndDate: Date | string },
  now: Date = new Date()
): Promise<void> {
  try {
    const startMs = new Date(appt.scheduledDate).getTime();
    const endMs = new Date(appt.scheduledEndDate).getTime();
    if (!Number.isFinite(endMs) || endMs <= startMs) return;
    if (!shouldAutoFill(startMs, now.getTime())) return;

    const { getEntitlements, checkFeature } = await import(
      '@/lib/billing/entitlements'
    );
    const ent = await getEntitlements(groomerId, now);
    if (checkFeature(ent, 'fillMyDay') !== null) return;

    const { fillMyDay } = await import('@/lib/fill/fill');
    const result = await fillMyDay(groomerId, startMs, endMs);
    if (!result.ok) {
      console.warn(
        `[fill] auto-fill for groomer ${groomerId} did not run: ${result.reason ?? 'unknown'}`
      );
    }
  } catch (err) {
    console.error(`[fill] auto-fill failed for groomer ${groomerId}:`, err);
  }
}
