import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { isValidObjectId } from 'mongoose';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import {
  AppointmentDetail,
  type AppointmentDetailData,
} from '@/components/portal/AppointmentDetail';
import type { AppointmentStatus, WeightUnit } from '@/types';

/**
 * Appointment detail page (server component).
 *
 * Loads a single appointment scoped to the authenticated groomer, with the
 * referenced client (name/phone/address), pet (name/breed/weight/age), and
 * service (name/durationMinutes) documents populated for display. The
 * serialized detail is handed to the {@link AppointmentDetail} client
 * component, which renders the full detail and the status-change controls that
 * call the `updateAppointmentStatus` action.
 *
 * If no appointment matches the id for this groomer (missing, foreign, or a
 * malformed id) we call `notFound()`.
 *
 * _Requirements: 12.1, 12.2, 12.4, 12.5_
 */

export const dynamic = 'force-dynamic';

interface PopulatedClient {
  name?: string;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  } | null;
}
interface PopulatedPet {
  name?: string;
  breed?: string;
  weight?: number;
  weightUnit?: WeightUnit;
  age?: number;
}
interface PopulatedService {
  name?: string;
  durationMinutes?: number;
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
  postGroomNotes?: string | null;
}

/** Compose a client's address parts into a single display string. */
function formatAddress(
  address: PopulatedClient['address'] | undefined
): string | null {
  if (!address) return null;
  const parts = [
    address.street,
    address.city,
    address.state,
    address.postalCode,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(', ') : null;
}

export default async function AppointmentDetailPage({
  params,
}: {
  params: { appointmentId: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/login');
  }

  const { appointmentId } = params;

  // A malformed id can never match; treat it as not found rather than letting
  // the query throw a cast error.
  if (!isValidObjectId(appointmentId)) {
    notFound();
  }

  await connectDB();

  const doc = await Appointment.findOne({
    _id: appointmentId,
    groomerId: session.user.id,
  })
    .populate('clientId', 'name phone address')
    .populate('petId', 'name breed weight weightUnit age')
    .populate('serviceId', 'name durationMinutes')
    .lean<LeanAppointment | null>();

  if (!doc) {
    notFound();
  }

  const detail: AppointmentDetailData = {
    id: String(doc._id),
    status: doc.status,
    scheduledDate: new Date(doc.scheduledDate).toISOString(),
    scheduledEndDate: new Date(doc.scheduledEndDate).toISOString(),
    serviceAddress: doc.serviceAddress ?? null,
    notes: doc.notes ?? null,
    postGroomNotes: doc.postGroomNotes ?? null,
    client: {
      name: doc.clientId?.name ?? null,
      phone: doc.clientId?.phone ?? null,
      address: formatAddress(doc.clientId?.address),
    },
    pet: {
      name: doc.petId?.name ?? null,
      breed: doc.petId?.breed ?? null,
      weight: doc.petId?.weight ?? null,
      weightUnit: doc.petId?.weightUnit ?? null,
      age: doc.petId?.age ?? null,
    },
    service: {
      name: doc.serviceId?.name ?? null,
      durationMinutes: doc.serviceId?.durationMinutes ?? null,
    },
  };

  return <AppointmentDetail appointment={detail} />;
}
