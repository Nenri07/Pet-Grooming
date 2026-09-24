'use server';

/**
 * Availability configuration server actions for the Groomer Portal.
 *
 * These run only on the server ('use server'). Every action authenticates the
 * caller via NextAuth and scopes each query to the authenticated groomer's
 * profile (`userId: session.user.id`) so one groomer can never read or mutate
 * another groomer's availability.
 *
 *  - `getAvailabilityConfig` returns the groomer's recurring weekly windows and
 *    manually blocked dates, plus whether the shared Google service-account
 *    calendar is configured for booking sync (Requirement 14.1 / 14.4 / 14.5).
 *  - `updateAvailabilityWindows` validates EACH window with the pure
 *    `validateWindow` helper and BLOCKS persistence when any window is invalid
 *    (bad increment, invalid day-of-week, or end <= start), returning the first
 *    error instead of saving (Requirement 14.1 / 14.6).
 *  - `addBlockedDate` requires the end date/time to be strictly after the start
 *    and refuses to add an inverted or malformed range (Requirement 14.4).
 *  - `removeBlockedDate` removes a blocked range by its array index.
 *
 * All actions RETURN a typed result envelope rather than throwing, so the UI
 * can surface inline validation errors and toasts. Mutations revalidate the
 * availability page so the editor reflects persisted state.
 *
 * The Google Calendar integration for PawPort uses a SHARED service-account
 * calendar (there is no per-groomer OAuth connect step): bookings sync to the
 * business calendar when the service account is configured. We read that
 * configuration lazily from `src/lib/calendar/client.ts` (via `isCalendarConfigured`)
 * only if that module exists; otherwise we report it as not configured without
 * importing it, so this action compiles before the calendar client lands
 * (task 8.x).
 *
 * _Requirements: 14.1, 14.4, 14.5, 14.6_
 */
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import {
  validateWindow,
  type AvailabilityWindowInput,
} from '@/lib/availability/validate';

// ---------------------------------------------------------------------------
// Shared shapes / result envelopes
// ---------------------------------------------------------------------------

/** A recurring weekly availability window as sent to/from the client. */
export interface AvailabilityWindowDTO {
  /** 0 = Monday .. 6 = Sunday. */
  dayOfWeek: number;
  /** "HH:mm", 15-minute increment. */
  startTime: string;
  /** "HH:mm", 15-minute increment, strictly after startTime. */
  endTime: string;
}

/** A manually blocked date/time range as sent to the client (ISO strings). */
export interface BlockedDateDTO {
  /** ISO 8601 start instant. */
  startDateTime: string;
  /** ISO 8601 end instant, strictly after startDateTime. */
  endDateTime: string;
}

/** The full availability configuration for the authenticated groomer. */
export interface AvailabilityConfig {
  windows: AvailabilityWindowDTO[];
  blockedDates: BlockedDateDTO[];
  /**
   * Whether the shared Google service-account calendar is configured so that
   * bookings sync to the business calendar (Requirement 14.5).
   */
  googleCalendarConfigured: boolean;
}

/** Result envelope returned by {@link getAvailabilityConfig}. */
export type GetAvailabilityResult =
  | { ok: true; config: AvailabilityConfig }
  | { ok: false; error: string };

/** Result envelope for {@link updateAvailabilityWindows}. */
export type UpdateWindowsResult =
  | { ok: true; windows: AvailabilityWindowDTO[] }
  | { ok: false; error: string };

/** Result envelope for {@link addBlockedDate} / {@link removeBlockedDate}. */
export type BlockedDatesResult =
  | { ok: true; blockedDates: BlockedDateDTO[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Whether the shared Google service-account calendar is configured. Reads
 * `isCalendarConfigured` from the calendar client lazily and only if that
 * module exists; any import/resolution failure is treated as "not configured"
 * so this action never crashes before the calendar client is implemented.
 */
async function isGoogleCalendarConfigured(): Promise<boolean> {
  try {
    // Dynamic import so a missing module (task 8.x) degrades gracefully rather
    // than failing to compile/resolve at load time.
    const mod = (await import('@/lib/calendar/client').catch(() => null)) as
      | { isCalendarConfigured?: (() => boolean) | boolean }
      | null;
    if (!mod) return false;
    const flag = mod.isCalendarConfigured;
    if (typeof flag === 'function') return Boolean(flag());
    return Boolean(flag);
  } catch {
    return false;
  }
}

/** Project a stored window (lean or hydrated) into the serializable DTO. */
function toWindowDTO(w: {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}): AvailabilityWindowDTO {
  return {
    dayOfWeek: w.dayOfWeek,
    startTime: w.startTime,
    endTime: w.endTime,
  };
}

/** Project a stored blocked date (Date instances) into ISO-string DTO. */
function toBlockedDTO(b: {
  startDateTime: Date | string;
  endDateTime: Date | string;
}): BlockedDateDTO {
  return {
    startDateTime: new Date(b.startDateTime).toISOString(),
    endDateTime: new Date(b.endDateTime).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getAvailabilityConfig
// ---------------------------------------------------------------------------

/**
 * Load the authenticated groomer's recurring availability windows and blocked
 * dates, along with whether the shared Google calendar is configured for sync
 * (Requirement 14.1 / 14.4 / 14.5).
 */
export async function getAvailabilityConfig(): Promise<GetAvailabilityResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view availability.' };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select('availabilityWindows blockedDates')
      .lean();

    const googleCalendarConfigured = await isGoogleCalendarConfigured();

    if (!profile) {
      // No profile yet (e.g. mid-onboarding) — return empty config so the page
      // still renders an editable, empty state.
      return {
        ok: true,
        config: { windows: [], blockedDates: [], googleCalendarConfigured },
      };
    }

    return {
      ok: true,
      config: {
        windows: (profile.availabilityWindows ?? []).map(toWindowDTO),
        blockedDates: (profile.blockedDates ?? []).map(toBlockedDTO),
        googleCalendarConfigured,
      },
    };
  } catch (error) {
    console.error('getAvailabilityConfig failed:', error);
    return {
      ok: false,
      error: "We couldn't load your availability right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// updateAvailabilityWindows
// ---------------------------------------------------------------------------

/**
 * Validate and persist the full set of recurring weekly availability windows.
 *
 * Every window is validated with the pure `validateWindow` helper (15-minute
 * increments, valid day-of-week, end strictly after start). If ANY window is
 * invalid, nothing is saved and the FIRST error message is returned so the UI
 * can show a validation error and prevent saving (Requirement 14.1 / 14.6).
 */
export async function updateAvailabilityWindows(
  windows: AvailabilityWindowInput[]
): Promise<UpdateWindowsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to update availability.' };
  }

  if (!Array.isArray(windows)) {
    return { ok: false, error: 'Invalid availability windows.' };
  }

  // Validate EACH window; block persistence on the first failure (Req 14.6).
  for (const window of windows) {
    const error = validateWindow(window);
    if (error) {
      return { ok: false, error };
    }
  }

  // Normalize to the stored shape (drop any extra client-only fields).
  const normalized: AvailabilityWindowDTO[] = windows.map((w) => ({
    dayOfWeek: w.dayOfWeek,
    startTime: w.startTime,
    endTime: w.endTime,
  }));

  try {
    await connectDB();

    const updated = await GroomerProfile.findOneAndUpdate(
      { userId: session.user.id },
      { $set: { availabilityWindows: normalized } },
      { new: true }
    )
      .select('availabilityWindows')
      .lean();

    if (!updated) {
      return { ok: false, error: 'Groomer profile not found.' };
    }

    revalidatePath('/availability');

    return {
      ok: true,
      windows: (updated.availabilityWindows ?? []).map(toWindowDTO),
    };
  } catch (error) {
    console.error('updateAvailabilityWindows failed:', error);
    return {
      ok: false,
      error: "We couldn't save your availability right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// addBlockedDate
// ---------------------------------------------------------------------------

/**
 * Add a manually blocked date/time range. The end MUST be strictly after the
 * start; an inverted, equal, or unparseable range is rejected without saving
 * (Requirement 14.4).
 */
export async function addBlockedDate(input: {
  startDateTime: string;
  endDateTime: string;
}): Promise<BlockedDatesResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to block dates.' };
  }

  const start = new Date(input?.startDateTime);
  const end = new Date(input?.endDateTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: 'Please provide a valid start and end date/time.' };
  }

  // End must be strictly after start (Requirement 14.4).
  if (end.getTime() <= start.getTime()) {
    return { ok: false, error: 'End date/time must be after the start date/time.' };
  }

  try {
    await connectDB();

    const updated = await GroomerProfile.findOneAndUpdate(
      { userId: session.user.id },
      { $push: { blockedDates: { startDateTime: start, endDateTime: end } } },
      { new: true }
    )
      .select('blockedDates')
      .lean();

    if (!updated) {
      return { ok: false, error: 'Groomer profile not found.' };
    }

    revalidatePath('/availability');

    return {
      ok: true,
      blockedDates: (updated.blockedDates ?? []).map(toBlockedDTO),
    };
  } catch (error) {
    console.error('addBlockedDate failed:', error);
    return {
      ok: false,
      error: "We couldn't block that date right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// removeBlockedDate
// ---------------------------------------------------------------------------

/**
 * Remove a blocked date/time range by its position in the stored array
 * (Requirement 14.4). Out-of-range indices are rejected so we never silently
 * drop the wrong entry.
 */
export async function removeBlockedDate(
  index: number
): Promise<BlockedDatesResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to unblock dates.' };
  }

  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, error: 'Invalid blocked date.' };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select('blockedDates')
      .lean();

    if (!profile) {
      return { ok: false, error: 'Groomer profile not found.' };
    }

    const current = profile.blockedDates ?? [];
    if (index >= current.length) {
      return { ok: false, error: 'That blocked date no longer exists.' };
    }

    const next = current.filter((_, i) => i !== index);

    const updated = await GroomerProfile.findOneAndUpdate(
      { userId: session.user.id },
      { $set: { blockedDates: next } },
      { new: true }
    )
      .select('blockedDates')
      .lean();

    if (!updated) {
      return { ok: false, error: 'Groomer profile not found.' };
    }

    revalidatePath('/availability');

    return {
      ok: true,
      blockedDates: (updated.blockedDates ?? []).map(toBlockedDTO),
    };
  } catch (error) {
    console.error('removeBlockedDate failed:', error);
    return {
      ok: false,
      error: "We couldn't remove that blocked date right now. Please try again.",
    };
  }
}
