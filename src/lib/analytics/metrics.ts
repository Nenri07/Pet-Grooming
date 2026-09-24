/**
 * Analytics metrics — pure calculation helpers.
 *
 * This module holds the DB-free, side-effect-free math behind the groomer
 * Analytics dashboard (Requirement 16). Keeping it pure means the no-show-rate
 * calculation can be exercised directly by Property 12 without a database, and
 * the server action ({@link ../../actions/analytics}) can reuse the same logic
 * over records it has already loaded.
 *
 * Definitions (per Requirement 16.1):
 *  - A *no-show* is an appointment whose scheduled date has passed
 *    (`scheduledDate < now`) AND whose status is neither 'completed' nor
 *    'cancelled'.
 *  - The *no-show rate* is `noShowCount / totalCount * 100`, rounded to one
 *    decimal place, and is `0` when there are no appointments.
 *
 * _Requirements: 16.1, 16.2, 16.3_
 */

import type { AppointmentStatus, TransactionStatus } from '@/types';

/**
 * The minimal appointment shape the no-show calculation needs. Deliberately
 * structural (not the Mongoose document) so callers can pass lean query rows,
 * generated test data, or plain objects interchangeably.
 */
export interface AppointmentLike {
  /** Appointment lifecycle status. */
  status: AppointmentStatus;
  /** When the appointment is/was scheduled to occur. */
  scheduledDate: Date;
}

/**
 * The minimal transaction shape the revenue calculation needs.
 */
export interface TransactionLike {
  /** Payment amount (in the deposit currency's major units, e.g. dollars). */
  amount: number;
  /** Transaction lifecycle status. */
  status: TransactionStatus;
}

/** Statuses that DISQUALIFY an appointment from being counted as a no-show. */
const NON_NO_SHOW_STATUSES: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
  'completed',
  'cancelled',
]);

/**
 * Round a value to exactly one decimal place.
 *
 * Uses `Number(value.toFixed(1))` for correctly-rounded decimal formatting;
 * this avoids the IEEE-754 re-multiplication error that `Math.round(x*10)/10`
 * can introduce for some magnitudes.
 */
function roundToOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * Whether a single appointment counts as a no-show relative to `now`:
 * its scheduled date has passed AND its status is neither completed nor
 * cancelled.
 */
export function isNoShow(appointment: AppointmentLike, now: Date): boolean {
  return (
    appointment.scheduledDate.getTime() < now.getTime() &&
    !NON_NO_SHOW_STATUSES.has(appointment.status)
  );
}

/**
 * Compute the no-show rate for a set of appointments, as a percentage rounded
 * to one decimal place.
 *
 * no-show = `scheduledDate < now` AND status not in {completed, cancelled}
 * rate    = noShowCount / totalCount * 100  (1 decimal place)
 * Returns `0` when there are no appointments (avoids divide-by-zero).
 *
 * This is the function imported by the Property 12 test.
 *
 * _Requirements: 16.1_
 */
export function computeNoShowRate(
  appointments: ReadonlyArray<AppointmentLike>,
  now: Date
): number {
  const totalCount = appointments.length;
  if (totalCount === 0) {
    return 0;
  }

  let noShowCount = 0;
  for (const appointment of appointments) {
    if (isNoShow(appointment, now)) {
      noShowCount += 1;
    }
  }

  return roundToOneDecimal((noShowCount / totalCount) * 100);
}

/**
 * Count the bookings in a set of appointments. This is simply the number of
 * appointment records for the month; kept as a named helper so the meaning is
 * explicit at call sites and easy to evolve.
 *
 * _Requirements: 16.1, 16.2_
 */
export function computeBookingsCount(
  appointments: ReadonlyArray<AppointmentLike>
): number {
  return appointments.length;
}

/**
 * Sum the revenue from succeeded deposit transactions.
 *
 * Only transactions with status `'succeeded'` contribute; pending, failed, and
 * refunded transactions are excluded so revenue reflects money actually
 * collected. The result is rounded to two decimal places to avoid trailing
 * floating-point noise when summing monetary amounts.
 *
 * _Requirements: 16.1, 16.2_
 */
export function computeRevenue(
  transactions: ReadonlyArray<TransactionLike>
): number {
  let total = 0;
  for (const transaction of transactions) {
    if (transaction.status === 'succeeded' && Number.isFinite(transaction.amount)) {
      total += transaction.amount;
    }
  }
  return Number(total.toFixed(2));
}

/** The three headline metrics computed for a single month. */
export interface MonthlyMetrics {
  /** Total number of appointments (bookings) in the month. */
  bookings: number;
  /** Total revenue from succeeded deposit transactions in the month. */
  revenue: number;
  /** No-show rate as a percentage, one decimal place. */
  noShowRate: number;
}

/**
 * Compute all three headline metrics for one month from its appointments and
 * transactions. Pure: `now` is injected so "has this appointment's date passed"
 * is deterministic and testable.
 *
 * _Requirements: 16.1, 16.2_
 */
export function computeMonthlyMetrics(
  appointments: ReadonlyArray<AppointmentLike>,
  transactions: ReadonlyArray<TransactionLike>,
  now: Date
): MonthlyMetrics {
  return {
    bookings: computeBookingsCount(appointments),
    revenue: computeRevenue(transactions),
    noShowRate: computeNoShowRate(appointments, now),
  };
}
