'use server';

/**
 * Public availability server action.
 *
 * Backs Step 4 of the public booking flow. Given a groomer's public booking
 * slug and the estimated service duration, it resolves the groomer's id from
 * the slug, computes the [now, now + 14 days] window (Requirement 6.1), and
 * delegates to the DB-backed {@link getAvailableSlots} engine.
 *
 * Design decisions:
 *  - The action RETURNS a typed result envelope rather than throwing, so the UI
 *    can distinguish "here are your slots" (possibly empty → no-availability
 *    message, Requirement 6.5) from "something went wrong".
 *  - `TimeSlot` carries `Date` objects, which do not survive the server→client
 *    boundary as `Date`s. The action therefore returns slots with ISO-string
 *    `start`/`end`; the client rehydrates them back into `Date`s before
 *    dispatching `SELECT_SLOT` (whose payload must be a real {@link TimeSlot}).
 *
 * _Requirements: 6.1, 6.4, 6.5_
 */
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { getAvailableSlots } from '@/lib/calendar/availability';

/** The number of calendar days of availability to display (Requirement 6.1). */
const AVAILABILITY_WINDOW_DAYS = 14;

/**
 * A time slot serialized for transport across the server→client boundary.
 * `start` / `end` are ISO-8601 strings (the client rehydrates them to `Date`).
 */
export interface SerializedTimeSlot {
  start: string;
  end: string;
  available: boolean;
}

/** Input accepted by {@link getPublicAvailability}. */
export interface GetPublicAvailabilityInput {
  /** The groomer's public booking slug. */
  groomerSlug: string;
  /** The estimated service duration, in minutes. */
  serviceDurationMinutes: number;
}

/**
 * Result envelope returned by {@link getPublicAvailability}.
 *
 * - On success: `ok` is true and `slots` holds the (possibly empty) list of
 *   available, future slots serialized for the client. An empty list is a
 *   valid success and drives the no-availability message (Requirement 6.5).
 * - On failure: `ok` is false and `error` holds a user-facing message.
 */
export type GetPublicAvailabilityResult =
  | { ok: true; slots: SerializedTimeSlot[] }
  | { ok: false; error: string };

/** Whether a value is a usable positive, finite duration in minutes. */
function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Compute available booking slots for the next 14 days for a groomer's public
 * booking page.
 *
 * Resolves the groomer id from the slug, builds the [now, now + 14 days]
 * window, and returns the available future slots. Returns an error envelope
 * (rather than throwing) so the UI can render a message and let the client
 * retry.
 */
export async function getPublicAvailability(
  input: GetPublicAvailabilityInput
): Promise<GetPublicAvailabilityResult> {
  const { groomerSlug, serviceDurationMinutes } = input;

  // Guard: a non-positive / missing duration can never yield a valid slot.
  if (!isPositiveFinite(serviceDurationMinutes)) {
    return {
      ok: false,
      error: "We couldn't load available times because the service duration is missing.",
    };
  }

  try {
    await connectDB();

    // 1. Resolve the groomer id from the public slug.
    const profile = await GroomerProfile.findOne({ groomerSlug })
      .select('userId')
      .lean();

    if (!profile) {
      return {
        ok: false,
        error: "We couldn't load available times because this groomer is unavailable.",
      };
    }

    // 2. Compute the [now, now + 14 days] window (Requirement 6.1).
    const startDate = new Date();
    const endDate = new Date(startDate.getTime());
    endDate.setDate(endDate.getDate() + AVAILABILITY_WINDOW_DAYS);

    // 3. Delegate to the availability engine.
    const slots = await getAvailableSlots({
      groomerId: profile.userId.toString(),
      startDate,
      endDate,
      serviceDurationMinutes,
    });

    // 4. Serialize dates for the client boundary.
    return {
      ok: true,
      slots: slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        available: s.available,
      })),
    };
  } catch (error) {
    console.error('getPublicAvailability failed:', error);
    return {
      ok: false,
      error: "We couldn't load available times right now. Please try again.",
    };
  }
}
