'use server';

/**
 * Analytics server action for the Groomer Portal.
 *
 * Runs only on the server ('use server'). Authenticates the caller via
 * NextAuth and scopes every query to the authenticated groomer
 * (`groomerId: session.user.id`) so one groomer can never read another
 * groomer's metrics.
 *
 * `getMonthlyAnalytics` loads the current month's and previous month's
 * Appointments (by `scheduledDate` range) and succeeded Transactions (by
 * `createdAt` range) for the groomer, then delegates all math to the pure
 * {@link ../lib/analytics/metrics} module (`computeMonthlyMetrics`). It returns
 * both months' metrics plus the numeric difference for bookings and revenue
 * only (Requirement 16.2). When the current month has neither appointments nor
 * transactions, `hasData` is false so the page can omit comparison indicators
 * and show zeros (Requirement 16.3).
 *
 * _Requirements: 16.1, 16.2, 16.3_
 */
import { getServerSession } from 'next-auth';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import { Transaction } from '@/lib/db/models/transaction';
import {
  computeMonthlyMetrics,
  buildMonthlySeries,
  type AppointmentLike,
  type TransactionLike,
  type MonthlyMetrics,
  type MonthlySeriesPoint,
  type DatedAppointment,
  type DatedTransaction,
} from '@/lib/analytics/metrics';
import type { AppointmentStatus, TransactionStatus } from '@/types';

/**
 * The month-over-month numeric difference. Per Requirement 16.2 the comparison
 * is shown only for the total bookings count and total revenue — no-show rate
 * is not diffed.
 */
export interface MonthlyDiff {
  /** current.bookings - previous.bookings */
  bookings: number;
  /** current.revenue - previous.revenue (2 decimal places) */
  revenue: number;
}

/** Result envelope returned by {@link getMonthlyAnalytics}. */
export type MonthlyAnalyticsResult =
  | {
      ok: true;
      current: MonthlyMetrics;
      previous: MonthlyMetrics;
      diff: MonthlyDiff;
      hasData: boolean;
    }
  | { ok: false; error: string };

/** Lean shapes for the fields the metrics module needs. */
interface LeanAppointment {
  status: AppointmentStatus;
  scheduledDate: Date;
}
interface LeanTransaction {
  amount: number;
  status: TransactionStatus;
}

/** Round a monetary difference to two decimal places (avoids float noise). */
function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Load and compute the current- and previous-month analytics for the
 * authenticated groomer.
 */
export async function getMonthlyAnalytics(): Promise<MonthlyAnalyticsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view analytics.' };
  }

  try {
    await connectDB();

    const now = new Date();

    // Month ranges (inclusive start / inclusive end) via date-fns.
    const currentStart = startOfMonth(now);
    const currentEnd = endOfMonth(now);
    const previousStart = startOfMonth(subMonths(now, 1));
    const previousEnd = endOfMonth(subMonths(now, 1));

    const groomerId = session.user.id;

    // Appointments are scoped by scheduledDate; transactions by createdAt and
    // restricted to succeeded (revenue = money actually collected). The metrics
    // module re-filters transactions by status, but querying only succeeded
    // rows keeps the payload small.
    const [
      currentAppointments,
      previousAppointments,
      currentTransactions,
      previousTransactions,
    ] = await Promise.all([
      Appointment.find({
        groomerId,
        scheduledDate: { $gte: currentStart, $lte: currentEnd },
      })
        .select('status scheduledDate')
        .lean<LeanAppointment[]>(),
      Appointment.find({
        groomerId,
        scheduledDate: { $gte: previousStart, $lte: previousEnd },
      })
        .select('status scheduledDate')
        .lean<LeanAppointment[]>(),
      Transaction.find({
        groomerId,
        status: 'succeeded',
        createdAt: { $gte: currentStart, $lte: currentEnd },
      })
        .select('amount status')
        .lean<LeanTransaction[]>(),
      Transaction.find({
        groomerId,
        status: 'succeeded',
        createdAt: { $gte: previousStart, $lte: previousEnd },
      })
        .select('amount status')
        .lean<LeanTransaction[]>(),
    ]);

    const currentAppts: AppointmentLike[] = currentAppointments.map((a) => ({
      status: a.status,
      scheduledDate: new Date(a.scheduledDate),
    }));
    const previousAppts: AppointmentLike[] = previousAppointments.map((a) => ({
      status: a.status,
      scheduledDate: new Date(a.scheduledDate),
    }));
    const currentTxns: TransactionLike[] = currentTransactions.map((t) => ({
      amount: t.amount,
      status: t.status,
    }));
    const previousTxns: TransactionLike[] = previousTransactions.map((t) => ({
      amount: t.amount,
      status: t.status,
    }));

    const current = computeMonthlyMetrics(currentAppts, currentTxns, now);
    const previous = computeMonthlyMetrics(previousAppts, previousTxns, now);

    // Comparison difference is only for bookings and revenue (Requirement 16.2).
    const diff: MonthlyDiff = {
      bookings: current.bookings - previous.bookings,
      revenue: roundMoney(current.revenue - previous.revenue),
    };

    // Zero-data: no appointments AND no transactions this month (Requirement
    // 16.3). Transactions were pre-filtered to succeeded, so a non-empty array
    // implies real collected revenue this month.
    const hasData =
      currentAppts.length > 0 || currentTxns.length > 0;

    return { ok: true, current, previous, diff, hasData };
  } catch (error) {
    console.error('getMonthlyAnalytics failed:', error);
    return {
      ok: false,
      error: "We couldn't load your analytics right now. Please try again.",
    };
  }
}

/** Result envelope returned by {@link getAnalyticsSeries}. */
export type AnalyticsSeriesResult =
  | { ok: true; series: MonthlySeriesPoint[] }
  | { ok: false; error: string };

/** Number of trailing months in the analytics series. */
const SERIES_MONTHS = 12;

/** Lean shape for series appointments (bucketed by scheduledDate). */
interface LeanSeriesAppointment {
  status: AppointmentStatus;
  scheduledDate: Date;
}
/** Lean shape for series transactions (bucketed by createdAt). */
interface LeanSeriesTransaction {
  amount: number;
  status: TransactionStatus;
  createdAt: Date;
}

/**
 * Load a trailing 12-month monthly series for the authenticated groomer:
 * `{ month, label, bookings, revenue, noShowRate }` per month, oldest → newest.
 *
 * Appointments are bucketed by `scheduledDate`, revenue by succeeded
 * transactions' `createdAt`. All bucketing/metric math is delegated to the pure
 * {@link buildMonthlySeries}. Degrades to a full zero-valued series (never an
 * empty array) on no data, so the chart always has a continuous x-axis.
 *
 * _Requirements: 16.1, 16.2, 16.3_
 */
export async function getAnalyticsSeries(): Promise<AnalyticsSeriesResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view analytics.' };
  }

  try {
    await connectDB();

    const now = new Date();
    const groomerId = session.user.id;

    // Window: from the start of the oldest bucket month to the end of this month.
    const windowStart = startOfMonth(subMonths(now, SERIES_MONTHS - 1));
    const windowEnd = endOfMonth(now);

    const [apptDocs, txnDocs] = await Promise.all([
      Appointment.find({
        groomerId,
        scheduledDate: { $gte: windowStart, $lte: windowEnd },
      })
        .select('status scheduledDate')
        .lean<LeanSeriesAppointment[]>(),
      Transaction.find({
        groomerId,
        status: 'succeeded',
        createdAt: { $gte: windowStart, $lte: windowEnd },
      })
        .select('amount status createdAt')
        .lean<LeanSeriesTransaction[]>(),
    ]);

    const appointments: DatedAppointment[] = apptDocs.map((a) => ({
      status: a.status,
      scheduledDate: new Date(a.scheduledDate),
    }));
    const transactions: DatedTransaction[] = txnDocs.map((t) => ({
      amount: t.amount,
      status: t.status,
      createdAt: new Date(t.createdAt),
    }));

    const series = buildMonthlySeries(appointments, transactions, now, SERIES_MONTHS);

    return { ok: true, series };
  } catch (error) {
    console.error('getAnalyticsSeries failed:', error);
    return {
      ok: false,
      error: "We couldn't load your analytics right now. Please try again.",
    };
  }
}
