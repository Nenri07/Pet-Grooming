/**
 * Groomer-timezone-aware date helpers (bugfix sprint — timezone root fix).
 *
 * Single source of truth for turning a groomer's wall-clock availability into
 * real UTC instants, and for formatting stored UTC instants back into the
 * groomer's local time for display. Before this, slot generation anchored
 * window hours to the SERVER's local zone (UTC on Vercel) and server-rendered
 * dashboards formatted with no timeZone, so a groomer's stored `timezone` was
 * ignored — producing 12:15 AM-type times and a "today" window off by the UTC
 * offset. Every consumer now routes its date math through here with the
 * groomer's IANA `timezone` (e.g. "Asia/Karachi"), defaulting to "UTC".
 *
 * Built on the already-installed `date-fns-tz` (`fromZonedTime` /
 * `formatInTimeZone`). Pure + dependency-light; safe on server and client.
 */
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

/**
 * Resolve a usable IANA timezone, falling back to UTC for anything absent,
 * blank, OR invalid. This is critical: `formatInTimeZone`/`fromZonedTime`
 * throw `RangeError: Invalid time value` on a non-IANA string (e.g. a stored
 * "PKT", "GMT+5", or even "Asia/Lahore" which isn't canonical), which would
 * crash EVERY server-rendered portal page that formats a time. We validate the
 * zone with `Intl` and degrade to UTC instead of throwing.
 */
function tzOf(timezone: string | null | undefined): string {
  const t = (timezone ?? '').trim();
  if (t.length === 0) return 'UTC';
  try {
    // Throws RangeError for an invalid IANA zone; succeeds for a valid one.
    new Intl.DateTimeFormat('en-US', { timeZone: t });
    return t;
  } catch {
    return 'UTC';
  }
}

/**
 * The UTC {@link Date} for a wall-clock time (`HH:mm`) on a given calendar day,
 * interpreted in the groomer's timezone. `day` supplies the Y/M/D (read in that
 * same zone); the returned instant is what gets stored/compared in UTC.
 */
export function wallTimeToUtc(
  day: Date,
  hours: number,
  minutes: number,
  timezone: string | null | undefined
): Date {
  const tz = tzOf(timezone);
  const ymd = formatInTimeZone(day, tz, 'yyyy-MM-dd');
  const hh = String(Math.trunc(hours)).padStart(2, '0');
  const mm = String(Math.trunc(minutes)).padStart(2, '0');
  return fromZonedTime(ymd + 'T' + hh + ':' + mm + ':00', tz);
}

/** The UTC instant at the START of the groomer-local day containing `date`. */
export function startOfDayInTz(date: Date, timezone: string | null | undefined): Date {
  const tz = tzOf(timezone);
  const ymd = formatInTimeZone(date, tz, 'yyyy-MM-dd');
  return fromZonedTime(ymd + 'T00:00:00', tz);
}

/** The UTC instant at the END of the groomer-local day containing `date`. */
export function endOfDayInTz(date: Date, timezone: string | null | undefined): Date {
  const tz = tzOf(timezone);
  const ymd = formatInTimeZone(date, tz, 'yyyy-MM-dd');
  return fromZonedTime(ymd + 'T23:59:59.999', tz);
}

/** Short time label (e.g. "9:30 AM") for a UTC instant, in the groomer's zone. */
export function timeLabelInTz(date: Date, timezone: string | null | undefined): string {
  return formatInTimeZone(date, tzOf(timezone), 'h:mm a');
}

/** Short date label (e.g. "Mon, Jun 3") for a UTC instant, in the groomer's zone. */
export function dateLabelInTz(date: Date, timezone: string | null | undefined): string {
  return formatInTimeZone(date, tzOf(timezone), 'EEE, MMM d');
}

/**
 * General formatter: format a UTC instant in the groomer's zone with a
 * `date-fns` format string. Thin pass-through so callers don't import
 * `date-fns-tz` directly.
 */
export function formatInTz(
  date: Date,
  timezone: string | null | undefined,
  fmt: string
): string {
  return formatInTimeZone(date, tzOf(timezone), fmt);
}