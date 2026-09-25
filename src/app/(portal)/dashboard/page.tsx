import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import {
  addDays,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  subMonths,
} from 'date-fns';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import { Transaction } from '@/lib/db/models/transaction';
import { GroomerProfile, type BookingMode } from '@/lib/db/models/groomer-profile';
import {
  computeMonthlyMetrics,
  type AppointmentLike,
  type TransactionLike,
} from '@/lib/analytics/metrics';
import {
  HaversineTravelProvider,
  DEFAULT_TRAVEL_CFG,
  type LatLng,
} from '@/lib/routing';
import {
  DashboardView,
  type DashboardData,
  type DashboardStop,
  type RadarItem,
  type MonthSummary,
} from '@/components/portal/DashboardView';
import { getEntitlements } from '@/lib/billing/entitlements';
import { getUsage } from '@/lib/sms/quota';
import type { AppointmentStatus } from '@/types';

/**
 * Dashboard page (server component) — Master Spec §8 bento dashboard.
 *
 * Fetches everything the bento needs and projects it into a plain, serializable
 * shape for {@link DashboardView}:
 *  - Today's Route: today's non-cancelled stops in time order, each with a
 *    travel chip (drive minutes + km) to the *next* stop, computed from
 *    `routeMeta` when present, else from haversine between the two stops'
 *    `location`s, else omitted.
 *  - Order Radar: the latest upcoming appointment(s) that carry `routeMeta`,
 *    formatted with distance / extra drive / best-fit label.
 *  - This month summary: bookings, revenue, no-show rate + previous-month diff.
 *  - Rebooking / SMS credits: placeholders (Phase 7 / Phase 4).
 *
 * _Master Spec: §8, §10.5. Requirements: 9.1, 9.2, 16.1_
 */

// Dashboards must reflect the latest bookings and status changes.
export const dynamic = 'force-dynamic';

/** Populated ref shapes after `.lean()`. */
interface PopulatedClient {
  name?: string;
  location?: LatLng | null;
}
interface PopulatedPet {
  name?: string;
}
interface PopulatedService {
  name?: string;
}
interface LeanRouteMeta {
  prevId?: unknown;
  nextId?: unknown;
  extraDriveMin?: number;
  fromPrevKm?: number;
  score?: number;
}
interface LeanAppointment {
  _id: unknown;
  clientId?: PopulatedClient | null;
  petId?: PopulatedPet | null;
  serviceId?: PopulatedService | null;
  serviceAddress?: string | null;
  scheduledDate: Date;
  status: AppointmentStatus;
  notes?: string | null;
  location?: LatLng | null;
  routeMeta?: LeanRouteMeta | null;
}

/** "Best fit" / "Nearby stop" label from a routeMeta score (Master Spec §10.4). */
function routeLabel(meta: LeanRouteMeta | null | undefined): string | null {
  if (!meta) return null;
  if (typeof meta.score === 'number' && meta.score >= 80) return 'Best fit';
  if (typeof meta.extraDriveMin === 'number' && meta.extraDriveMin <= 8) {
    return 'Nearby stop';
  }
  return null;
}

/** Format a Date to a short local time label (server-side, stable). */
function timeLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Percentage diff helper for the month summary. Returns null when undefined. */
function pctDiff(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login');
  }
  const groomerId = session.user.id;

  await connectDB();

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekEnd = addDays(now, 7);

  // Groomer profile drives travel-chip math + booking mode (Order Radar).
  const profile = await GroomerProfile.findOne({ userId: groomerId })
    .lean<{
      baseLocation?: LatLng | null;
      avgSpeedKmh?: number;
      roadFactor?: number;
      parkingMin?: number;
      bookingMode?: BookingMode;
    }>()
    .exec();

  const travel = new HaversineTravelProvider({
    roadFactor: profile?.roadFactor ?? DEFAULT_TRAVEL_CFG.roadFactor,
    avgSpeedKmh: profile?.avgSpeedKmh ?? DEFAULT_TRAVEL_CFG.avgSpeedKmh,
    parkingMin: profile?.parkingMin ?? DEFAULT_TRAVEL_CFG.parkingMin,
  });
  const bookingMode: BookingMode = profile?.bookingMode ?? 'instant';

  // ---- Today's stops (non-cancelled, time-ordered) ----
  const todayDocs = await Appointment.find({
    groomerId,
    scheduledDate: { $gte: todayStart, $lte: todayEnd },
    status: { $ne: 'cancelled' },
  })
    .populate('clientId', 'name location')
    .populate('petId', 'name')
    .populate('serviceId', 'name')
    .sort({ scheduledDate: 1 })
    .lean<LeanAppointment[]>();

  // Build stops, then compute the travel chip to the NEXT stop.
  const stops: DashboardStop[] = [];
  for (let i = 0; i < todayDocs.length; i += 1) {
    const doc = todayDocs[i];
    const start = new Date(doc.scheduledDate);
    const from = doc.location ?? doc.clientId?.location ?? null;

    let travelToNext: DashboardStop['travelToNext'] = null;
    const next = todayDocs[i + 1];
    if (next) {
      // Prefer stored routeMeta on the *next* stop when it references this one.
      const nextMeta = next.routeMeta;
      const to = next.location ?? next.clientId?.location ?? null;
      if (
        nextMeta &&
        typeof nextMeta.extraDriveMin === 'number' &&
        typeof nextMeta.fromPrevKm === 'number' &&
        String(nextMeta.prevId ?? '') === String(doc._id)
      ) {
        travelToNext = {
          minutes: Math.max(0, Math.round(nextMeta.extraDriveMin)),
          km: Number(nextMeta.fromPrevKm.toFixed(1)),
        };
      } else if (from && to) {
        travelToNext = {
          minutes: Math.round(await travel.minutes(from, to)),
          km: Number((await travel.km(from, to)).toFixed(1)),
        };
      }
    }

    stops.push({
      id: String(doc._id),
      petName: doc.petId?.name ?? null,
      clientName: doc.clientId?.name ?? null,
      serviceName: doc.serviceId?.name ?? null,
      serviceAddress: doc.serviceAddress ?? null,
      scheduledDate: start.toISOString(),
      timeLabel: timeLabel(start),
      status: doc.status,
      travelToNext,
    });
  }

  // ---- Order Radar: upcoming appts (today→+7d) carrying routeMeta ----
  const radarDocs = await Appointment.find({
    groomerId,
    scheduledDate: { $gte: todayStart, $lte: endOfDay(weekEnd) },
    status: 'upcoming',
    'routeMeta.extraDriveMin': { $exists: true },
  })
    .populate('clientId', 'name')
    .populate('petId', 'name')
    .sort({ createdAt: -1 })
    .limit(3)
    .lean<LeanAppointment[]>();

  const radar: RadarItem[] = radarDocs.map((doc) => {
    const start = new Date(doc.scheduledDate);
    return {
      id: String(doc._id),
      petName: doc.petId?.name ?? null,
      clientName: doc.clientId?.name ?? null,
      scheduledDate: start.toISOString(),
      timeLabel: timeLabel(start),
      fromPrevKm:
        typeof doc.routeMeta?.fromPrevKm === 'number'
          ? Number(doc.routeMeta.fromPrevKm.toFixed(1))
          : null,
      extraDriveMin:
        typeof doc.routeMeta?.extraDriveMin === 'number'
          ? Math.max(0, Math.round(doc.routeMeta.extraDriveMin))
          : null,
      label: routeLabel(doc.routeMeta),
    };
  });

  // ---- This month summary (bookings, revenue, no-show rate + MoM diff) ----
  const thisMonthStart = startOfMonth(now);
  const thisMonthEnd = endOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));

  const [thisApptDocs, lastApptDocs, thisTxnDocs, lastTxnDocs] = await Promise.all([
    Appointment.find({
      groomerId,
      scheduledDate: { $gte: thisMonthStart, $lte: thisMonthEnd },
    })
      .select('status scheduledDate')
      .lean<Array<{ status: AppointmentStatus; scheduledDate: Date }>>(),
    Appointment.find({
      groomerId,
      scheduledDate: { $gte: lastMonthStart, $lte: lastMonthEnd },
    })
      .select('status scheduledDate')
      .lean<Array<{ status: AppointmentStatus; scheduledDate: Date }>>(),
    Transaction.find({
      groomerId,
      createdAt: { $gte: thisMonthStart, $lte: thisMonthEnd },
    })
      .select('amount status')
      .lean<Array<{ amount: number; status: TransactionLike['status'] }>>(),
    Transaction.find({
      groomerId,
      createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd },
    })
      .select('amount status')
      .lean<Array<{ amount: number; status: TransactionLike['status'] }>>(),
  ]);

  const toApptLike = (
    rows: Array<{ status: AppointmentStatus; scheduledDate: Date }>
  ): AppointmentLike[] =>
    rows.map((r) => ({ status: r.status, scheduledDate: new Date(r.scheduledDate) }));

  const thisMetrics = computeMonthlyMetrics(
    toApptLike(thisApptDocs),
    thisTxnDocs as TransactionLike[],
    now
  );
  const lastMetrics = computeMonthlyMetrics(
    toApptLike(lastApptDocs),
    lastTxnDocs as TransactionLike[],
    now
  );

  const monthSummary: MonthSummary = {
    bookings: thisMetrics.bookings,
    revenue: thisMetrics.revenue,
    noShowRate: thisMetrics.noShowRate,
    bookingsDiffPct: pctDiff(thisMetrics.bookings, lastMetrics.bookings),
    revenueDiffPct: pctDiff(thisMetrics.revenue, lastMetrics.revenue),
    noShowRateDiff: Number((thisMetrics.noShowRate - lastMetrics.noShowRate).toFixed(1)),
  };

  // Entitlements drive the SMS meter (real allowance/usage) and the Order Radar
  // lock hint (Master Spec §13.1, §13.4). Best-effort: getEntitlements falls
  // back to a Pro-trial view and getUsage returns 0 when Redis is unconfigured,
  // so the dashboard always renders even in a credential-free environment.
  const entitlements = await getEntitlements(groomerId);
  const smsUsed = await getUsage(groomerId);

  const data: DashboardData = {
    stops,
    radar,
    bookingMode,
    monthSummary,
    smsIncluded: entitlements.smsIncluded,
    smsUsed,
    // UI hint only — the server gate on /api/portal/radar is authoritative.
    radarLocked: !entitlements.features.includes('orderRadar'),
  };

  return <DashboardView data={data} />;
}
