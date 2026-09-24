import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import {
  DashboardView,
  type DashboardAppointment,
} from '@/components/portal/DashboardView';
import type { AppointmentStatus } from '@/types';

/**
 * Dashboard page (server component).
 *
 * Fetches the authenticated groomer's appointments scheduled between the start
 * of today and the end of 7 days from now, restricted to actionable statuses
 * (upcoming / in-progress) and sorted ascending by scheduled date/time. The
 * referenced client, pet, and service documents are populated for their
 * display fields, then everything is projected into a plain, serializable
 * shape before being handed to the DashboardView client component.
 *
 * _Requirements: 9.1, 9.2_
 */

// Always render fresh appointment data (dashboards must reflect the latest
// bookings and status changes rather than a cached snapshot).
export const dynamic = 'force-dynamic';

/** Shapes populated refs return as after `.lean()`. */
interface PopulatedClient {
  name?: string;
}
interface PopulatedPet {
  name?: string;
}
interface PopulatedService {
  name?: string;
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
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer (Requirement 1.5). The
  // middleware already gates this, but we guard here so the query never runs
  // without a groomer id.
  if (!session?.user?.id) {
    redirect('/login');
  }

  await connectDB();

  const now = new Date();
  const weekEnd = addDays(now, 7);

  const docs = await Appointment.find({
    groomerId: session.user.id,
    scheduledDate: { $gte: startOfDay(now), $lte: endOfDay(weekEnd) },
    status: { $in: ['upcoming', 'in-progress'] },
  })
    .populate('clientId', 'name phone')
    .populate('petId', 'name breed')
    .populate('serviceId', 'name')
    .sort({ scheduledDate: 1 })
    .lean<LeanAppointment[]>();

  // Project the Mongoose documents into a plain, serializable shape so the
  // client component receives only JSON-safe primitives.
  const appointments: DashboardAppointment[] = docs.map((doc) => ({
    id: String(doc._id),
    petName: doc.petId?.name ?? null,
    clientName: doc.clientId?.name ?? null,
    serviceName: doc.serviceId?.name ?? null,
    serviceAddress: doc.serviceAddress ?? null,
    scheduledDate: new Date(doc.scheduledDate).toISOString(),
    status: doc.status,
    notes: doc.notes ?? null,
  }));

  return <DashboardView appointments={appointments} />;
}
