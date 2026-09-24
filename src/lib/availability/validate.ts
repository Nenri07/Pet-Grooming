/**
 * Pure, DB-free validators for availability configuration.
 *
 * These helpers contain the business rules for recurring weekly availability
 * windows so they can be unit- and property-tested without a database, and
 * reused by both the server actions (`src/actions/availability.ts`) and the
 * client editor (`src/components/portal/AvailabilityConfig.tsx`) to keep the
 * client-side and server-side validation identical.
 *
 * Rules (Requirement 14.1 / 14.6):
 *  - Times are "HH:mm" strings in 15-minute increments from "00:00" to "23:45".
 *  - A window's end time MUST be strictly after its start time.
 *  - dayOfWeek is an integer 0..6 (0 = Monday .. 6 = Sunday).
 *
 * Everything here is a pure function of its inputs — no clock, no I/O.
 *
 * _Requirements: 14.1, 14.6_
 */

/** Number of minutes between valid slot boundaries. */
const INCREMENT_MINUTES = 15;
/** Minutes in a day; the last valid boundary is 23:45 (below this). */
const MINUTES_PER_DAY = 24 * 60;

/** A recurring weekly availability window. dayOfWeek: 0 = Monday .. 6 = Sunday. */
export interface AvailabilityWindowInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * Parse an "HH:mm" string to minutes-since-midnight, or `null` when the string
 * is malformed. Strictly requires two digits for the hour and minute so that
 * "9:00", "09:0" and "09:60" are all rejected.
 */
export function parseTimeToMinutes(hhmm: string): number | null {
  if (typeof hhmm !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Whether `hhmm` is a valid 15-minute increment in the range 00:00..23:45
 * (Requirement 14.1). "24:00" and any value at or past the end of the day are
 * rejected because a start/end time must fall on a real time-of-day boundary.
 */
export function isValidTimeIncrement(hhmm: string): boolean {
  const minutes = parseTimeToMinutes(hhmm);
  if (minutes === null) return false;
  if (minutes < 0 || minutes >= MINUTES_PER_DAY) return false;
  return minutes % INCREMENT_MINUTES === 0;
}

/**
 * Whether `end` is strictly after `start` (Requirement 14.6). Returns false
 * when either value is not a parseable "HH:mm" string, so callers can rely on
 * this alone to reject inverted or malformed ranges.
 */
export function isEndAfterStart(start: string, end: string): boolean {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes === null || endMinutes === null) return false;
  return endMinutes > startMinutes;
}

/** Whether `dayOfWeek` is an integer in the valid 0..6 range. */
export function isValidDayOfWeek(dayOfWeek: number): boolean {
  return Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6;
}

/**
 * Validate a single availability window, returning a user-facing error message
 * describing the FIRST rule violated, or `null` when the window is valid.
 *
 * Checks, in order: day-of-week range, start-time increment, end-time
 * increment, then end-after-start (Requirement 14.1 / 14.6).
 */
export function validateWindow(window: AvailabilityWindowInput): string | null {
  if (!isValidDayOfWeek(window.dayOfWeek)) {
    return 'Day of week must be between Monday and Sunday.';
  }
  if (!isValidTimeIncrement(window.startTime)) {
    return 'Start time must be a 15-minute increment between 00:00 and 23:45.';
  }
  if (!isValidTimeIncrement(window.endTime)) {
    return 'End time must be a 15-minute increment between 00:00 and 23:45.';
  }
  if (!isEndAfterStart(window.startTime, window.endTime)) {
    return 'End time must be after start time.';
  }
  return null;
}
