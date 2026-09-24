import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import {
  AppointmentsList,
  type AppointmentListRow,
} from '@/components/portal/AppointmentsList';
import type { AppointmentStatus } from '@/types';

/**
 * Appointments list page (server component).
 *
 * Loads ALL of the authenticated groomer's appointments, sorted ascending by
 * scheduled date/time, with the referenced client, pet, and service documents
 * populated for their display fields. The full, serializable list is handed to
 * the {@link AppointmentsList} client component which applies the status and
 * date-range filtering entirely on the client (Requirement 12.4).
 *
 * We load the whole list here (rather than re-querying per filter change) so
 * that filtering is instant and does not round-trip to the server. The query
 * is always scoped to `groomerId` so a groomer only ever sees their own
 * appointments.
 *
 * _Requirements: 12.1, 12.4_
 */

// Appointment data must reflect the latest bookings and status changes rather
// than a cached snapshot.
export const dynamic = 'force-dynamic';

/** Shapes populated refs return as after `.lean()`. */
interface PopulatedClient {
  name?: string;
}
interface PopulatedPet {
  name?: string;
  breed?: string;
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
  scheduledEndDate: Date;
  status: AppointmentStatus;
  notes?: string | null;
}

export default async function AppointmentsPage() {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer. Middleware already gates
  // this, but we guard here so the query never runs without a groomer id.
  if (!session?.user?.id) {
    redirect('/login');
  }

  await connectDB();

  const docs = await Appointment.find({ groomerId: session.user.id })
    .populate('clientId', 'name')
    .populate('petId', 'name breed')
    .populate('serviceId', 'name')
    .sort({ scheduledDate: 1 })
    .lean<LeanAppointment[]>();

  // Project into a plain, serializable shape (JSON-safe primitives only) for
  // the client component.
  const appointments: AppointmentListRow[] = docs.map((doc) => ({
    id: String(doc._id),
    petName: doc.petId?.name ?? null,
    petBreed: doc.petId?.breed ?? null,
    clientName: doc.clientId?.name ?? null,
    serviceName: doc.serviceId?.name ?? null,
    serviceAddress: doc.serviceAddress ?? null,
    scheduledDate: new Date(doc.scheduledDate).toISOString(),
    status: doc.status,
    notes: doc.notes ?? null,
  }));

  return <AppointmentsList appointments={appointments} />;
}
