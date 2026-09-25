'use server';

/**
 * Appointment management server actions.
 *
 * These run only on the server ('use server'). They back the Groomer Portal's
 * appointment status controls and list view.
 *
 * Design decisions:
 *  - Status transitions are gated by the PURE state machine in
 *    `src/lib/appointments/status.ts` (Requirement 12.1). Keeping the legal-
 *    transition logic pure lets the Property 5 test exercise it directly.
 *  - Every query is scoped to `{ _id, groomerId: session.user.id }` so a
 *    groomer can only ever mutate their own appointments.
 *  - Actions RETURN a typed result envelope ({ ok, error? }) rather than
 *    throwing, so the UI can render inline errors. Status changes are immediate
 *    in Mongo only — the native calendar is the source of truth and the ICS
 *    feed reflects the change (Master Spec §9; Google Calendar sync removed).
 *
 * _Requirements: 12.1, 12.2_
 */
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import { canTransition } from '@/lib/appointments/status';
import type { AppointmentStatus } from '@/types';

/** All appointment statuses, used to validate incoming values. */
const APPOINTMENT_STATUSES = [
  'upcoming',
  'in-progress',
  'completed',
  'cancelled',
] as const;

/** Maximum length of post-groom notes (Requirement 12.2). */
const MAX_POST_GROOM_NOTES = 2000;

/** Input accepted by {@link updateAppointmentStatus}. */
export interface UpdateAppointmentStatusInput {
  /** The appointment to transition (scoped to the authed groomer). */
  appointmentId: string;
  /** The desired next status. */
  newStatus: AppointmentStatus;
  /**
   * Optional post-groom notes, persisted only when transitioning to
   * 'completed'. Absence is allowed — the status change still succeeds
   * (Requirement 12.2).
   */
  postGroomNotes?: string;
}

/**
 * Typed result envelope for appointment mutations.
 *
 * - On success: `ok` is true. The status change is immediate and authoritative
 *   in Mongo (Master Spec §9).
 * - On failure: `ok` is false and `error` holds a user-facing message.
 */
export type AppointmentActionResult =
  | { ok: true }
  | { ok: false; error: string };

const updateStatusSchema = z.object({
  appointmentId: z.string().min(1),
  newStatus: z.enum(APPOINTMENT_STATUSES),
  postGroomNotes: z.string().max(MAX_POST_GROOM_NOTES).optional(),
});

/**
 * Transition an appointment to a new status.
 *
 * Flow:
 *  1. Authenticate via NextAuth (Requirement — portal actions are private).
 *  2. Validate the input shape (including the 2000-char notes cap).
 *  3. Load the appointment scoped to the authed groomer.
 *  4. Reject illegal transitions using the pure state machine (Requirement 12.1).
 *  5. Persist the new status; when completing, persist optional notes but
 *     never require them (Requirement 12.2). The change is immediate in Mongo
 *     and reflected in the native calendar / ICS feed (Master Spec §9).
 *
 * Returns a result envelope rather than throwing.
 */
export async function updateAppointmentStatus(
  input: UpdateAppointmentStatusInput
): Promise<AppointmentActionResult> {
  // 1. Authenticate.
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to update an appointment.' };
  }

  // 2. Validate input.
  const parsed = updateStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'The appointment update request was invalid.' };
  }
  const { appointmentId, newStatus, postGroomNotes } = parsed.data;

  try {
    await connectDB();

    // 3. Load the appointment, scoped to this groomer so cross-tenant access
    //    is impossible.
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      groomerId: session.user.id,
    });

    if (!appointment) {
      return { ok: false, error: 'Appointment not found.' };
    }

    const currentStatus = appointment.status as AppointmentStatus;

    // 4. Reject invalid transitions (Requirement 12.1).
    if (!canTransition(currentStatus, newStatus)) {
      return {
        ok: false,
        error: `Cannot change appointment status from ${currentStatus} to ${newStatus}.`,
      };
    }

    // 5. Apply the new status. When completing, persist optional notes; their
    //    absence must NOT block the status change (Requirement 12.2).
    appointment.status = newStatus;
    if (newStatus === 'completed' && typeof postGroomNotes === 'string') {
      const trimmed = postGroomNotes.trim();
      if (trimmed.length > 0) {
        appointment.postGroomNotes = trimmed;
      }
    }
    await appointment.save();

    // The status change is now immediate and authoritative in Mongo. The
    // native calendar and the read-only ICS feed reflect it directly — there
    // is no external calendar to sync (Master Spec §9).

    // Refresh the dashboard and appointments list views.
    revalidatePath('/dashboard');
    revalidatePath('/appointments');

    return { ok: true };
  } catch (error) {
    console.error('updateAppointmentStatus failed:', error);
    return {
      ok: false,
      error: "We couldn't update the appointment right now. Please try again.",
    };
  }
}

/** Filters accepted by {@link listAppointments}. */
export interface ListAppointmentsInput {
  /** Restrict to a single status. */
  status?: AppointmentStatus;
  /** Only include appointments scheduled on/after this instant. */
  from?: Date;
  /** Only include appointments scheduled on/before this instant. */
  to?: Date;
}

/** A single appointment row returned by {@link listAppointments}. */
export interface AppointmentListItem {
  id: string;
  clientId: string;
  petId: string;
  serviceId: string;
  scheduledDate: Date;
  scheduledEndDate: Date;
  status: AppointmentStatus;
  serviceAddress?: string;
  notes?: string;
  postGroomNotes?: string;
}

/** Typed result envelope for {@link listAppointments}. */
export type ListAppointmentsResult =
  | { ok: true; appointments: AppointmentListItem[] }
  | { ok: false; error: string };

/**
 * List the authenticated groomer's appointments, sorted by scheduled date
 * ascending, optionally filtered by status and/or a date range.
 *
 * Backs the appointments list view (task 10.3). All results are scoped to the
 * authed groomer.
 *
 * _Requirements: 12.4_
 */
export async function listAppointments(
  input: ListAppointmentsInput = {}
): Promise<ListAppointmentsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view appointments.' };
  }

  const { status, from, to } = input;

  try {
    await connectDB();

    const filter: Record<string, unknown> = { groomerId: session.user.id };

    if (status && APPOINTMENT_STATUSES.includes(status)) {
      filter.status = status;
    }

    if (from instanceof Date || to instanceof Date) {
      const range: Record<string, Date> = {};
      if (from instanceof Date) range.$gte = from;
      if (to instanceof Date) range.$lte = to;
      filter.scheduledDate = range;
    }

    const docs = await Appointment.find(filter)
      .sort({ scheduledDate: 1 })
      .lean();

    const appointments: AppointmentListItem[] = docs.map((doc: any) => ({
      id: doc._id.toString(),
      clientId: doc.clientId?.toString(),
      petId: doc.petId?.toString(),
      serviceId: doc.serviceId?.toString(),
      scheduledDate: doc.scheduledDate,
      scheduledEndDate: doc.scheduledEndDate,
      status: doc.status as AppointmentStatus,
      serviceAddress: doc.serviceAddress,
      notes: doc.notes,
      postGroomNotes: doc.postGroomNotes,
    }));

    return { ok: true, appointments };
  } catch (error) {
    console.error('listAppointments failed:', error);
    return {
      ok: false,
      error: "We couldn't load your appointments right now. Please try again.",
    };
  }
}
