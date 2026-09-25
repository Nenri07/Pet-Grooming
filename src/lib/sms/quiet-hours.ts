/**
 * Quiet-hours gate (Master Spec §12.3) — PURE.
 *
 * Marketing-type messages (rebook nudges, review requests, Fill My Day offers)
 * may only go out between 08:00 and 20:30 in the groomer's local time.
 * Transactional messages (confirmations, reminders, receipts, operational
 * status) may go anytime.
 *
 * {@link isWithinQuietHours} is PURE: it takes an already-resolved local time
 * (hour + minute) so it has no timezone dependency and is trivially testable.
 * The timezone resolution (IANA string → local hour/minute) is the caller's
 * job; {@link resolveLocalTime} is a small convenience that uses `Intl` and is
 * kept separate from the pure decision.
 *
 * _Master Spec: §12.3_
 */
import type { SmsKind } from './provider';
import { isTransactional } from './quota';

/** Allowed marketing send window (inclusive start, inclusive end), local time. */
export const QUIET_HOURS = {
  /** Earliest allowed hour for marketing (08:00). */
  startHour: 8,
  startMinute: 0,
  /** Latest allowed time for marketing (20:30). */
  endHour: 20,
  endMinute: 30,
} as const;

/** A local wall-clock time (already timezone-resolved). */
export interface LocalTime {
  /** 0..23 */
  hour: number;
  /** 0..59 */
  minute: number;
}

/**
 * PURE: is `local` INSIDE quiet hours (i.e. a marketing message must NOT be
 * sent) for the given `kind`?
 *
 * - Transactional kinds are never in quiet hours → always returns `false`.
 * - Marketing kinds return `true` when the local time is OUTSIDE the
 *   08:00–20:30 window (i.e. it is "quiet"), and `false` when inside the window
 *   (OK to send).
 *
 * Boundaries are inclusive: exactly 08:00 and exactly 20:30 are allowed
 * (not quiet).
 */
export function isWithinQuietHours(local: LocalTime, kind: SmsKind): boolean {
  // Transactional traffic ignores quiet hours entirely.
  if (isTransactional(kind)) return false;

  const minutes = local.hour * 60 + local.minute;
  const startMinutes = QUIET_HOURS.startHour * 60 + QUIET_HOURS.startMinute;
  const endMinutes = QUIET_HOURS.endHour * 60 + QUIET_HOURS.endMinute;

  const insideWindow = minutes >= startMinutes && minutes <= endMinutes;
  // "Within quiet hours" == outside the allowed marketing window.
  return !insideWindow;
}

/**
 * Resolve a UTC instant to a groomer-local {@link LocalTime} for an IANA
 * timezone using `Intl.DateTimeFormat`. Falls back to UTC on an invalid zone.
 * Not pure (reads a formatter), so it is kept out of {@link isWithinQuietHours}.
 */
export function resolveLocalTime(when: Date, timeZone: string | undefined): LocalTime {
  const zone = timeZone && timeZone.trim() ? timeZone : 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(when);
    const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const minutePart = parts.find((p) => p.type === 'minute')?.value ?? '0';
    let hour = parseInt(hourPart, 10);
    if (hour === 24) hour = 0; // some environments emit "24" for midnight
    const minute = parseInt(minutePart, 10);
    return {
      hour: Number.isFinite(hour) ? hour : 0,
      minute: Number.isFinite(minute) ? minute : 0,
    };
  } catch {
    return { hour: when.getUTCHours(), minute: when.getUTCMinutes() };
  }
}
