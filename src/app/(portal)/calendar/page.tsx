import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import {
  CalendarView,
  type CalendarAppointment,
  type CalendarProfile,
} from '@/components/portal/CalendarView';
import type { AppointmentStatus } from '@/types';

/**
 * Calendar page (server component) — Master Spec §9.6.
 *
 * Auth-gates the authenticated groomer, then loads their appointments for a
 * window centred on the current week (previous week → +2 weeks, so navigating
 * a few days either way stays populated without a re-fetch), with the
 * referenced client/pet/service populated for display and the geocoded
 * location kept for travel chips. It also loads the profile fields the
 * calendar needs (weekly windows, buffer, timezone, ICS feed URL), projects
 * everything to a serializable shape, and renders {@link CalendarView}.
 *
 * The list view at `/appointments` is kept as-is; this ADDS the calendar.
 *
 * _Master Spec: §9.5, §9.6_
 */

// Calendar data must reflect the latest bookings, reschedules, and status
// changes rather than a cached snapshot.
export const dynamic = 'force-dynamic';

interface PopulatedRef {
  name?: string;
  breed?: string;
}
interface LeanCalendarAppointment {
  _id: unknown;
  clientId?: PopulatedRef | null;
  petId?: PopulatedRef | null;
  serviceId?: (PopulatedRef & { _id?: unknown }) | null;
  serviceAddress?: string | null;
  scheduledDate: Date;
  scheduledEndDate: Date;
  status: AppointmentStatus;
  location?: { lat: number; lng: number } | null;
  routeMeta?: { extraDriveMin?: number; fromPrevKm?: number } | null;
  notes?: string | null;
}

/** Start of the day, `days` ago, in UTC. */
function dayOffset(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export default async function CalendarPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login');
  }

  await connectDB();
  const groomerId = session.user.id;

  const now = new Date();
  // Window: 7 days back → 21 days forward (covers prev/current/next weeks).
  const windowStart = dayOffset(now, -7);
  const windowEnd = dayOffset(now, 22);

  const [docs, profileDoc] = await Promise.all([
    Appointment.find({
      groomerId,
      scheduledDate: { $gte: windowStart, $lt: windowEnd },
    })
      .populate('clientId', 'name')
      .populate('petId', 'name breed')
      .populate('serviceId', 'name')
      .sort({ scheduledDate: 1 })
      .lean<LeanCalendarAppointment[]>(),
    GroomerProfile.findOne({ userId: groomerId })
      .select('availabilityWindows bufferMin timezone icsFeedToken')
      .lean(),
  ]);

  const appointments: CalendarAppointment[] = docs.map((doc) => ({
    id: String(doc._id),
    petName: doc.petId?.name ?? null,
    petBreed: doc.petId?.breed ?? null,
    clientName: doc.clientId?.name ?? null,
    serviceName: doc.serviceId?.name ?? null,
    serviceId: doc.serviceId && '_id' in doc.serviceId ? String(doc.serviceId._id) : null,
    serviceAddress: doc.serviceAddress ?? null,
    startMs: new Date(doc.scheduledDate).getTime(),
    endMs: new Date(doc.scheduledEndDate).getTime(),
    status: doc.status,
    lat: doc.location?.lat ?? null,
    lng: doc.location?.lng ?? null,
    extraDriveMin:
      typeof doc.routeMeta?.extraDriveMin === 'number' ? doc.routeMeta.extraDriveMin : null,
    fromPrevKm:
      typeof doc.routeMeta?.fromPrevKm === 'number' ? doc.routeMeta.fromPrevKm : null,
  }));

  const p = profileDoc as
    | {
        availabilityWindows?: { dayOfWeek: number; startTime: string; endTime: string }[];
        bufferMin?: number;
        timezone?: string;
        icsFeedToken?: string;
      }
    | null;

  const feedBase = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  const feedUrl =
    p?.icsFeedToken && p.icsFeedToken.length > 0
      ? `${feedBase}/api/ics/${p.icsFeedToken}.ics`
      : null;

  const profile: CalendarProfile = {
    windows: (p?.availabilityWindows ?? []).map((w) => ({
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
    })),
    bufferMin: typeof p?.bufferMin === 'number' ? p.bufferMin : 10,
    timezone: p?.timezone ?? 'UTC',
    feedUrl,
  };

  return <CalendarView appointments={appointments} profile={profile} />;
}
