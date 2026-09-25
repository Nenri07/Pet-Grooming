/**
 * Analytics 12-month series builder — pure unit tests.
 *
 * Exercises the DB-free {@link buildMonthlySeries} core used by the Analytics
 * charts (Requirement 16.1, 16.2, 16.3). No database, no server action — the
 * bucketing math is fully deterministic because `now` is injected.
 *
 * Covered:
 *  - Window shape: exactly `months` buckets, oldest → newest, ending in the
 *    month of `now`, with correct `YYYY-MM` keys and short labels.
 *  - Appointments bucket by `scheduledDate`; revenue buckets by transaction
 *    `createdAt`; per-bucket metrics are correct.
 *  - Only succeeded transactions contribute to revenue.
 *  - Records outside the window are ignored; empty months are zero-valued.
 *  - No-show rate is computed per bucket relative to `now`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMonthlySeries,
  type DatedAppointment,
  type DatedTransaction,
} from '@/lib/analytics/metrics';

/** A fixed "now": 15 Jun 2024, so the trailing 12-month window is Jul23→Jun24. */
const NOW = new Date('2024-06-15T12:00:00.000Z');

function appt(dateIso: string, status: DatedAppointment['status']): DatedAppointment {
  return { scheduledDate: new Date(dateIso), status };
}
function txn(
  dateIso: string,
  amount: number,
  status: DatedTransaction['status'] = 'succeeded'
): DatedTransaction {
  return { createdAt: new Date(dateIso), amount, status };
}

describe('buildMonthlySeries', () => {
  it('emits exactly `months` buckets ending in the month of now, oldest first', () => {
    const series = buildMonthlySeries([], [], NOW, 12);

    expect(series).toHaveLength(12);
    expect(series[0].month).toBe('2023-07');
    expect(series[0].label).toBe('Jul');
    expect(series[11].month).toBe('2024-06');
    expect(series[11].label).toBe('Jun');

    // All zero with no data (continuous x-axis, never empty).
    for (const point of series) {
      expect(point.bookings).toBe(0);
      expect(point.revenue).toBe(0);
      expect(point.noShowRate).toBe(0);
    }
  });

  it('honors a custom window length', () => {
    const series = buildMonthlySeries([], [], NOW, 3);
    expect(series.map((p) => p.month)).toEqual(['2024-04', '2024-05', '2024-06']);
  });

  it('buckets appointments by scheduledDate and revenue by createdAt', () => {
    const appointments: DatedAppointment[] = [
      // April: 2 bookings
      appt('2024-04-03T10:00:00.000Z', 'completed'),
      appt('2024-04-20T10:00:00.000Z', 'completed'),
      // June: 1 booking
      appt('2024-06-02T10:00:00.000Z', 'upcoming'),
    ];
    const transactions: DatedTransaction[] = [
      txn('2024-04-05T10:00:00.000Z', 40),
      txn('2024-04-25T10:00:00.000Z', 60), // April revenue = 100
      txn('2024-06-01T10:00:00.000Z', 25), // June revenue = 25
    ];

    const series = buildMonthlySeries(appointments, transactions, NOW, 12);
    const byMonth = Object.fromEntries(series.map((p) => [p.month, p]));

    expect(byMonth['2024-04'].bookings).toBe(2);
    expect(byMonth['2024-04'].revenue).toBe(100);

    expect(byMonth['2024-06'].bookings).toBe(1);
    expect(byMonth['2024-06'].revenue).toBe(25);

    // A month with no records stays zeroed.
    expect(byMonth['2024-05'].bookings).toBe(0);
    expect(byMonth['2024-05'].revenue).toBe(0);
  });

  it('excludes non-succeeded transactions from revenue', () => {
    const transactions: DatedTransaction[] = [
      txn('2024-05-05T10:00:00.000Z', 50, 'succeeded'),
      txn('2024-05-06T10:00:00.000Z', 999, 'pending'),
      txn('2024-05-07T10:00:00.000Z', 999, 'failed'),
      txn('2024-05-08T10:00:00.000Z', 999, 'refunded'),
    ];
    const series = buildMonthlySeries([], transactions, NOW, 12);
    const may = series.find((p) => p.month === '2024-05')!;
    expect(may.revenue).toBe(50);
  });

  it('ignores records outside the trailing window', () => {
    const appointments: DatedAppointment[] = [
      appt('2023-06-10T10:00:00.000Z', 'completed'), // one month before window start
      appt('2025-01-10T10:00:00.000Z', 'upcoming'), // future, beyond now's month
    ];
    const transactions: DatedTransaction[] = [
      txn('2023-06-10T10:00:00.000Z', 500),
      txn('2025-01-10T10:00:00.000Z', 500),
    ];
    const series = buildMonthlySeries(appointments, transactions, NOW, 12);

    const totalBookings = series.reduce((s, p) => s + p.bookings, 0);
    const totalRevenue = series.reduce((s, p) => s + p.revenue, 0);
    expect(totalBookings).toBe(0);
    expect(totalRevenue).toBe(0);
  });

  it('computes no-show rate per bucket relative to now', () => {
    // May 2024: 4 appts, 2 are no-shows (past + not completed/cancelled).
    const appointments: DatedAppointment[] = [
      appt('2024-05-01T10:00:00.000Z', 'upcoming'), // past, not completed → no-show
      appt('2024-05-02T10:00:00.000Z', 'in-progress'), // past, not completed → no-show
      appt('2024-05-03T10:00:00.000Z', 'completed'), // not a no-show
      appt('2024-05-04T10:00:00.000Z', 'cancelled'), // not a no-show
    ];
    const series = buildMonthlySeries(appointments, [], NOW, 12);
    const may = series.find((p) => p.month === '2024-05')!;
    expect(may.bookings).toBe(4);
    expect(may.noShowRate).toBe(50);
  });
});
