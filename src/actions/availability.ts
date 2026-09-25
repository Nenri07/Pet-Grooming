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
 *    manually blocked dates, plus the read-only ICS feed URL when a feed token
 *    exists (Master Spec §9; Google Calendar removed).
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
 * PawPort has no external calendar dependency (Master Spec §9). Availability is
 * native (weekly windows + manual blocks) and a one-way, read-only ICS feed
 * lets groomers subscribe from Apple/Google/Outlook. `getAvailabilityConfig`
 * returns the feed URL when a token already exists; the UI offers a "generate
 * feed" action (`getOrCreateIcsFeedToken`) when it does not.
 *
 * _Requirements: 14.1, 14.4, 14.6_
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
   * The absolute URL of the groomer's read-only ICS feed, or `null` when no
   * feed token has been generated yet. When null, the UI offers a "generate
   * feed" action that calls `getOrCreateIcsFeedToken` (Master Spec §9.6).
   */
  feedUrl: string | null;
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
 * Build the absolute ICS feed URL for a stored token, or `null` when no token
 * exists yet. Read-only, one-way export (Master Spec §9.6). Mirrors the URL
 * shape produced by `getOrCreateIcsFeedToken` so the UI can display a stable
 * subscribe link. We only READ the token here — generation is an explicit UI
 * action so a token is never minted just by viewing the page.
 */
function feedUrlFromToken(token: string | undefined | null): string | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  const path = `/api/ics/${token}.ics`;
  return base ? `${base}${path}` : path;
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
 * dates, along with the read-only ICS feed URL when a feed token exists
 * (Requirement 14.1 / 14.4; Master Spec §9.6).
 */
export async function getAvailabilityConfig(): Promise<GetAvailabilityResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view availability.' };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select('availabilityWindows blockedDates icsFeedToken')
      .lean();

    if (!profile) {
      // No profile yet (e.g. mid-onboarding) — return empty config so the page
      // still renders an editable, empty state.
      return {
        ok: true,
        config: { windows: [], blockedDates: [], feedUrl: null },
      };
    }

    return {
      ok: true,
      config: {
        windows: (profile.availabilityWindows ?? []).map(toWindowDTO),
        blockedDates: (profile.blockedDates ?? []).map(toBlockedDTO),
        feedUrl: feedUrlFromToken(profile.icsFeedToken),
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
