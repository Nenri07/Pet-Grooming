/**
 * Redis-backed tentative hold layer (Master Spec §9.4).
 *
 * When a client picks a slot, we place a 10-minute hold in Redis so a second
 * client cannot book the same time mid-checkout. Holds are stored as
 * `hold:{gid}:{holdId}` (EX 600) and indexed in a per-day set
 * `holds:{gid}:{yyyy-mm-dd}` so the slot generator can subtract active holds
 * cheaply.
 *
 * This supersedes the Mongo-based `reservation.ts` for the new native booking
 * flow; the older file is intentionally left in place for the legacy path.
 *
 * Holds are represented in a {@link TimeBlock}-compatible way (`{ start, end }`
 * Date pair) via {@link holdsToBlocks} so the pure availability core in
 * `availability.ts` can subtract them without knowing about Redis.
 *
 * _Master Spec: §9.4, §15_
 */
import { nanoid } from 'nanoid';
import type { TimeBlock } from '@/lib/calendar/availability';
import {
  setHold,
  deleteHold,
  getActiveHolds as redisGetActiveHolds,
  type HoldRecord,
} from '@/lib/redis';

/** An active hold in domain terms (millisecond epochs + owner email). */
export interface ActiveHold {
  holdId: string;
  startMs: number;
  endMs: number;
  email: string;
}

/** Raised when a hold cannot be created because the slot is already held. */
export class SlotHeldError extends Error {
  constructor(message = 'Slot is already held') {
    super(message);
    this.name = 'SlotHeldError';
  }
}

/** Derive the `yyyy-mm-dd` day key (UTC) a hold belongs to from its start. */
export function dayKeyFromMs(startMs: number): string {
  return new Date(startMs).toISOString().slice(0, 10);
}

/**
 * Pure overlap check between a candidate interval and a set of active holds,
 * optionally ignoring a specific hold (used when refreshing your own hold).
 * Half-open intervals: touching endpoints do NOT overlap.
 *
 * DB/Redis-free so it is directly unit-testable.
 */
export function conflictsWithHolds(
  startMs: number,
  endMs: number,
  holds: ActiveHold[],
  ignoreHoldId?: string
): boolean {
  return holds.some(
    (h) =>
      h.holdId !== ignoreHoldId && startMs < h.endMs && endMs > h.startMs
  );
}

/**
 * Convert active holds to {@link TimeBlock}s so the availability core can treat
 * them exactly like appointments/blocked dates. PURE.
 */
export function holdsToBlocks(holds: ActiveHold[]): TimeBlock[] {
  return holds.map((h) => ({ start: new Date(h.startMs), end: new Date(h.endMs) }));
}

/**
 * Read every currently-active hold for a groomer on `dateStr` (`yyyy-mm-dd`).
 * Expired/missing keys are dropped lazily by the Redis layer.
 */
export async function getActiveHolds(
  groomerId: string,
  dateStr: string
): Promise<ActiveHold[]> {
  const holds = await redisGetActiveHolds(groomerId, dateStr);
  return holds.map((h) => ({
    holdId: h.holdId,
    startMs: h.startMs,
    endMs: h.endMs,
    email: h.email,
  }));
}

/**
 * Create a 10-minute hold on `[startMs, endMs)` for a groomer.
 *
 * Validates the slot is not already covered by an ACTIVE hold (read via
 * {@link getActiveHolds}); if it is, throws {@link SlotHeldError}. Note this is
 * best-effort at the hold layer — the authoritative race-safety happens at
 * commit time under the booking lock (§9.4 step 1–2).
 *
 * @returns the generated `holdId`.
 */
export async function createHold(
  groomerId: string,
  startMs: number,
  endMs: number,
  clientEmail: string
): Promise<{ holdId: string }> {
  const dateStr = dayKeyFromMs(startMs);
  const existing = await getActiveHolds(groomerId, dateStr);

  if (conflictsWithHolds(startMs, endMs, existing)) {
    throw new SlotHeldError();
  }

  const holdId = nanoid();
  const record: HoldRecord = { startMs, endMs, email: clientEmail };
  await setHold(groomerId, holdId, dateStr, record);

  return { holdId };
}

/**
 * Release a hold: delete its key and remove it from the day set.
 * `dateStr` is `yyyy-mm-dd`; if omitted, the caller must know the day the hold
 * belongs to (holds are day-scoped in the set index).
 */
export async function releaseHold(
  groomerId: string,
  holdId: string,
  dateStr: string
): Promise<void> {
  await deleteHold(groomerId, holdId, dateStr);
}
