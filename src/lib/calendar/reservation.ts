/**
 * Tentative slot reservation.
 *
 * When a client selects a time slot in the booking flow, we place a 10-minute
 * tentative hold on it (Requirement 6.3) so a second client cannot book the
 * same slot mid-checkout (Requirement 6.4). Holds are keyed by a browser
 * `sessionId` and expire automatically via the TTL index on the Reservation
 * model.
 *
 * The logic is split into two layers so the exclusivity rule can be property-
 * and unit-tested without a database:
 *
 *   - `canReserve` — a PURE, DB-free decision helper. Given the current
 *     (possibly absent) reservation, the requesting session, and the current
 *     time, it returns whether the slot is reservable. This is the export the
 *     Property 8 atomicity test should import.
 *   - `reserveSlot` — the DB-backed wrapper. It reads the existing reservation
 *     for the slot, delegates the yes/no decision to `canReserve`, and (when
 *     allowed) upserts this session's hold with a fresh 10-minute expiry.
 *
 * _Requirements: 6.3, 6.4_
 */
import type { TimeSlot } from '@/types';

/** How long a tentative hold lasts before it expires (Requirement 6.3). */
export const RESERVATION_TTL_MS = 10 * 60 * 1000;

/**
 * The minimal shape of an existing reservation the pure decision helper needs.
 * Deliberately DB-agnostic so `canReserve` can be tested with plain objects.
 */
export interface ExistingReservation {
  /** The session that currently holds the slot. */
  sessionId: string;
  /** When the hold expires; a hold at or before `now` is considered gone. */
  expiresAt: Date;
}

/** Input to the pure {@link canReserve} decision. */
export interface CanReserveInput {
  /**
   * The reservation currently recorded for this exact groomer + slot, if any.
   * `null`/`undefined` means the slot is unheld.
   */
  existing: ExistingReservation | null | undefined;
  /** The session requesting the hold. */
  sessionId: string;
  /** The current time used to judge whether `existing` has expired. */
  now: Date;
}

/**
 * Pure reservation rule: a slot is reservable iff there is no UNEXPIRED
 * reservation held by a DIFFERENT session.
 *
 * Concretely, the request is allowed when any of the following hold:
 *   - there is no existing reservation, or
 *   - the existing reservation has expired (`expiresAt <= now`), or
 *   - the existing reservation is already owned by the same session
 *     (re-selecting / refreshing your own hold is always fine).
 *
 * This helper is DB-free and deterministic so the Property 8 atomicity test
 * can verify exclusivity across many inputs without a database.
 */
export function canReserve({ existing, sessionId, now }: CanReserveInput): boolean {
  if (!existing) return true;

  const isExpired = existing.expiresAt.getTime() <= now.getTime();
  if (isExpired) return true;

  // An unexpired hold held by someone else blocks the reservation.
  return existing.sessionId === sessionId;
}

/**
 * Place (or refresh) a tentative 10-minute hold on a slot for `sessionId`.
 *
 * Reads the existing hold for the exact groomer + slot, delegates the decision
 * to the pure {@link canReserve} helper, and — when allowed — upserts this
 * session's reservation with a fresh expiry.
 *
 * @returns `true` if the slot is now held by this session, `false` if another
 *          session holds an unexpired reservation on it (Requirement 6.4).
 */
export async function reserveSlot(
  groomerId: string,
  slot: TimeSlot,
  sessionId: string
): Promise<boolean> {
  // Imported lazily so the pure helpers above can be used without pulling in
  // Mongoose / a DB connection (keeps the tested core DB-free).
  const { connectDB } = await import('@/lib/db/connect');
  const { Reservation } = await import('@/lib/db/models/reservation');

  await connectDB();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);

  // Read the current hold for this exact slot (expired docs may briefly linger
  // before the TTL reaper removes them, so `canReserve` re-checks expiry).
  const existing = await Reservation.findOne({
    groomerId,
    slotStart: slot.start,
    slotEnd: slot.end,
  }).lean();

  if (!canReserve({ existing, sessionId, now })) {
    return false;
  }

  // Atomic check-and-reserve: upsert this session's hold with a fresh expiry.
  await Reservation.findOneAndUpdate(
    { groomerId, slotStart: slot.start, slotEnd: slot.end, sessionId },
    { $set: { expiresAt } },
    { upsert: true }
  );

  return true;
}
