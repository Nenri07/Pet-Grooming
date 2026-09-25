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
import type { TimeBlock } from '@/lib/calendar/availability';
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

    // Best-effort: completing an appointment sets the pet's rebooking due date
    // (§11.4). lastGroomAt = now; nextDueAt = now + coat/override interval. A
    // failure here must never fail the status change.
    if (newStatus === 'completed') {
      try {
        const { Pet } = await import('@/lib/db/models/pet');
        const { computeNextDueAt } = await import('@/lib/rebooking');
        const pet = await Pet.findById(appointment.petId)
          .select('coatCondition rebookIntervalWeeks')
          .lean();
        if (pet) {
          const p = pet as { coatCondition?: string; rebookIntervalWeeks?: number };
          const groomedAt = new Date();
          const nextDueAt = computeNextDueAt(
            groomedAt,
            p.coatCondition,
            p.rebookIntervalWeeks
          );
          await Pet.updateOne(
            { _id: appointment.petId },
            { $set: { lastGroomAt: groomedAt, nextDueAt } }
          );
        }
      } catch (err) {
        console.error('[status] setting pet nextDueAt failed (non-fatal):', err);
      }
    }

    // Best-effort: cancelling an appointment cancels its pending reminders
    // (§12.3) so a client is never reminded about a cancelled booking. Never
    // fails the status change.
    if (newStatus === 'cancelled') {
      try {
        const { cancelRemindersForAppointment } = await import('@/lib/sms/reminders');
        await cancelRemindersForAppointment(appointmentId).catch(() => {});
      } catch (err) {
        console.error('[status] cancelReminders failed (non-fatal):', err);
      }
    }

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

// ---------------------------------------------------------------------------
// Calendar mutations (Master Spec §9.5, §9.6) — reschedule + manual create.
//
// Both reuse the SAME buffer-padded overlap semantics as the race-safe commit
// (`isSlotStillFree` → pure `hasConflict`), so the calendar UI can never create
// a double-booking. Every query is scoped to `groomerId: session.user.id`.
// ---------------------------------------------------------------------------

const MS_PER_MINUTE = 60 * 1000;

/** Resolve the authed groomer's buffer minutes (default 10), matching commit.ts. */
async function getBufferMin(groomerId: string): Promise<number> {
  const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
  const profile = await GroomerProfile.findOne({ userId: groomerId })
    .select('bufferMin')
    .lean();
  const b = (profile as { bufferMin?: number } | null)?.bufferMin;
  return typeof b === 'number' && b >= 0 ? b : 10;
}

/**
 * Load the groomer's OTHER non-cancelled appointments overlapping the padded
 * window and normalise them to {@link TimeBlock}s for the pure overlap check.
 * `excludeId` keeps the appointment being moved out of its own conflict set.
 */
async function loadOverlapBlocks(
  groomerId: string,
  startMs: number,
  endMs: number,
  bufferMin: number,
  excludeId?: string
): Promise<TimeBlock[]> {
  const padMs = bufferMin * MS_PER_MINUTE;
  const windowStart = new Date(startMs - padMs);
  const windowEnd = new Date(endMs + padMs);

  const filter: Record<string, unknown> = {
    groomerId,
    status: { $ne: 'cancelled' },
    scheduledDate: { $lt: windowEnd },
    scheduledEndDate: { $gt: windowStart },
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const overlapping = await Appointment.find(filter).lean();
  return (
    overlapping as unknown as Array<{ scheduledDate: Date; scheduledEndDate: Date }>
  ).map((a) => ({
    start: new Date(a.scheduledDate),
    end: new Date(a.scheduledEndDate),
  }));
}

/** `yyyy-mm-dd` (UTC) for cache-scoping a slot day. */
function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Input accepted by {@link rescheduleAppointment}. */
export interface RescheduleAppointmentInput {
  appointmentId: string;
  /** New start, epoch ms (already snapped to the 15-min grid by the UI). */
  newStartMs: number;
  /** New end, epoch ms. */
  newEndMs: number;
}

/** Result envelope for {@link rescheduleAppointment}. */
export type RescheduleAppointmentResult =
  | { ok: true }
  | { ok: false; reason: 'conflict' }
  | { ok: false; error: string };

const rescheduleSchema = z.object({
  appointmentId: z.string().min(1),
  newStartMs: z.number().int().finite(),
  newEndMs: z.number().int().finite(),
});

/**
 * Move an appointment to a new time (drag / resize in the calendar).
 *
 * Re-checks overlap against the groomer's OTHER non-cancelled appointments in
 * `[newStart − buffer, newEnd + buffer]` using the same pure semantics as the
 * booking commit. On conflict returns `{ ok: false, reason: 'conflict' }` so
 * the UI snaps the block back; a move into an overlap is NEVER allowed.
 *
 * _Master Spec: §9.5, §9.6_
 */
export async function rescheduleAppointment(
  input: RescheduleAppointmentInput
): Promise<RescheduleAppointmentResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to reschedule an appointment.' };
  }

  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'The reschedule request was invalid.' };
  }
  const { appointmentId, newStartMs, newEndMs } = parsed.data;

  if (newEndMs <= newStartMs) {
    return { ok: false, error: 'The appointment must end after it starts.' };
  }

  try {
    await connectDB();
    const groomerId = session.user.id;

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      groomerId,
    });
    if (!appointment) {
      return { ok: false, error: 'Appointment not found.' };
    }

    // Cancelled appointments are not draggable on the calendar.
    if (appointment.status === 'cancelled') {
      return { ok: false, error: 'Cancelled appointments cannot be rescheduled.' };
    }

    const { isSlotStillFree } = await import('@/lib/calendar/commit');
    const bufferMin = await getBufferMin(groomerId);
    const blocks = await loadOverlapBlocks(
      groomerId,
      newStartMs,
      newEndMs,
      bufferMin,
      appointmentId
    );

    if (!isSlotStillFree(newStartMs, newEndMs, blocks, bufferMin)) {
      // Never allow moving into an overlap — UI snaps back.
      return { ok: false, reason: 'conflict' };
    }

    const prevDay = dayStr(new Date(appointment.scheduledDate).getTime());
    const existingReminderIds = (appointment as { reminderJobIds?: string[] }).reminderJobIds;
    appointment.scheduledDate = new Date(newStartMs);
    appointment.scheduledEndDate = new Date(newEndMs);
    await appointment.save();

    // Best-effort reminder reschedule (§12.3): cancel the old jobs and schedule
    // fresh 24h/2h reminders against the new time. Never fails the reschedule.
    try {
      const { cancelReminders, scheduleReminders } = await import('@/lib/sms/reminders');
      await cancelReminders(existingReminderIds).catch(() => {});
      await scheduleReminders({
        groomerId,
        appointmentId,
        startAtMs: newStartMs,
      }).catch(() => {});
    } catch (err) {
      console.error('[reschedule] reminder reschedule failed (non-fatal):', err);
    }

    // Invalidate the affected day(s) so slot generation reflects the move.
    const { invalidateSlotsCache } = await import('@/lib/calendar/slots');
    const newDay = dayStr(newStartMs);
    await invalidateSlotsCache(groomerId, prevDay).catch(() => {});
    if (newDay !== prevDay) {
      await invalidateSlotsCache(groomerId, newDay).catch(() => {});
    }

    revalidatePath('/calendar');
    revalidatePath('/appointments');
    revalidatePath('/dashboard');

    return { ok: true };
  } catch (error) {
    console.error('rescheduleAppointment failed:', error);
    return {
      ok: false,
      error: "We couldn't reschedule the appointment right now. Please try again.",
    };
  }
}

/** Input accepted by {@link createManualAppointment}. */
export interface CreateManualAppointmentInput {
  /** Existing client (required — new-client creation is stubbed for now). */
  clientId: string;
  /** Existing pet belonging to the client. */
  petId: string;
  /** Existing service (its default duration is not enforced here). */
  serviceId: string;
  /** Slot start, epoch ms. */
  startMs: number;
  /** Slot end, epoch ms. */
  endMs: number;
  /** Optional service address string. */
  serviceAddress?: string;
  /** Optional appointment notes. */
  notes?: string;
}

/** Result envelope for {@link createManualAppointment}. */
export type CreateManualAppointmentResult =
  | { ok: true; appointmentId: string }
  | { ok: false; reason: 'conflict' }
  | { ok: false; error: string };

const createManualSchema = z.object({
  clientId: z.string().min(1),
  petId: z.string().min(1),
  serviceId: z.string().min(1),
  startMs: z.number().int().finite(),
  endMs: z.number().int().finite(),
  serviceAddress: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

/**
 * Create a manual appointment (phone/text bookings) from the calendar.
 *
 * Minimal by design (Master Spec §9.5): it accepts an EXISTING client, pet, and
 * service — inline new-client/new-pet creation is intentionally left as a
 * follow-up (stubbed). The slot is overlap-checked with the same buffer-padded
 * semantics as the booking commit; on conflict it returns
 * `{ ok: false, reason: 'conflict' }`. Created appointments are
 * `source: 'manual'`, `status: 'upcoming'`.
 *
 * _Master Spec: §9.5, §9.6_
 */
export async function createManualAppointment(
  input: CreateManualAppointmentInput
): Promise<CreateManualAppointmentResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to add an appointment.' };
  }

  const parsed = createManualSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'The appointment request was invalid.' };
  }
  const { clientId, petId, serviceId, startMs, endMs, serviceAddress, notes } =
    parsed.data;

  if (endMs <= startMs) {
    return { ok: false, error: 'The appointment must end after it starts.' };
  }

  try {
    await connectDB();
    const groomerId = session.user.id;

    // Validate that client / pet / service all belong to this groomer.
    const { Client } = await import('@/lib/db/models/client');
    const { Pet } = await import('@/lib/db/models/pet');
    const { Service } = await import('@/lib/db/models/service');

    const [client, pet, service] = await Promise.all([
      Client.findOne({ _id: clientId, groomerId }).select('_id').lean(),
      Pet.findOne({ _id: petId, groomerId }).select('_id clientId').lean(),
      Service.findOne({ _id: serviceId, groomerId }).select('_id').lean(),
    ]);

    if (!client) return { ok: false, error: 'Client not found.' };
    if (!pet) return { ok: false, error: 'Pet not found.' };
    if (!service) return { ok: false, error: 'Service not found.' };
    if (String((pet as { clientId?: unknown }).clientId) !== String(clientId)) {
      return { ok: false, error: 'That pet does not belong to the selected client.' };
    }

    const { isSlotStillFree } = await import('@/lib/calendar/commit');
    const bufferMin = await getBufferMin(groomerId);
    const blocks = await loadOverlapBlocks(groomerId, startMs, endMs, bufferMin);

    if (!isSlotStillFree(startMs, endMs, blocks, bufferMin)) {
      return { ok: false, reason: 'conflict' };
    }

    const created = await Appointment.create({
      groomerId,
      clientId,
      petId,
      serviceId,
      serviceIds: [serviceId],
      scheduledDate: new Date(startMs),
      scheduledEndDate: new Date(endMs),
      status: 'upcoming',
      source: 'manual',
      serviceAddress,
      notes,
    });

    const { invalidateSlotsCache } = await import('@/lib/calendar/slots');
    await invalidateSlotsCache(groomerId, dayStr(startMs)).catch(() => {});

    revalidatePath('/calendar');
    revalidatePath('/appointments');
    revalidatePath('/dashboard');

    return { ok: true, appointmentId: String(created._id) };
  } catch (error) {
    console.error('createManualAppointment failed:', error);
    return {
      ok: false,
      error: "We couldn't add the appointment right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Manual-booking picker data (Master Spec §9.6).
//
// The "Add booking" modal requires picking an EXISTING client, one of that
// client's pets, and a service. This action returns the minimal serializable
// option set for those pickers, all scoped to the authed groomer.
// ---------------------------------------------------------------------------

/** A client option, with its pets nested for cascading selection. */
export interface ManualBookingClient {
  id: string;
  name: string;
  serviceAddress?: string;
  pets: { id: string; name: string; breed?: string }[];
}

/** A service option, with its default duration for prefilling the end time. */
export interface ManualBookingService {
  id: string;
  name: string;
  durationMinutes: number;
}

/** Result envelope for {@link getManualBookingOptions}. */
export type ManualBookingOptionsResult =
  | { ok: true; clients: ManualBookingClient[]; services: ManualBookingService[] }
  | { ok: false; error: string };

/**
 * Load the authed groomer's clients (each with their pets) and active services
 * for the manual "Add booking" modal. All scoped to `groomerId`.
 */
export async function getManualBookingOptions(): Promise<ManualBookingOptionsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to add an appointment.' };
  }

  try {
    await connectDB();
    const groomerId = session.user.id;

    const { Client } = await import('@/lib/db/models/client');
    const { Pet } = await import('@/lib/db/models/pet');
    const { Service } = await import('@/lib/db/models/service');

    const [clientDocs, petDocs, serviceDocs] = await Promise.all([
      Client.find({ groomerId }).select('name address').sort({ name: 1 }).lean(),
      Pet.find({ groomerId }).select('name breed clientId').sort({ name: 1 }).lean(),
      Service.find({ groomerId, isActive: true })
        .select('name durationMinutes')
        .sort({ name: 1 })
        .lean(),
    ]);

    const petsByClient = new Map<string, { id: string; name: string; breed?: string }[]>();
    for (const p of petDocs as unknown as Array<{
      _id: unknown;
      name: string;
      breed?: string;
      clientId: unknown;
    }>) {
      const key = String(p.clientId);
      const arr = petsByClient.get(key) ?? [];
      arr.push({ id: String(p._id), name: p.name, breed: p.breed });
      petsByClient.set(key, arr);
    }

    const clients: ManualBookingClient[] = (
      clientDocs as unknown as Array<{
        _id: unknown;
        name: string;
        address?: { street?: string; city?: string; state?: string; postalCode?: string };
      }>
    ).map((c) => {
      const a = c.address;
      const serviceAddress = a
        ? [a.street, a.city, a.state, a.postalCode].filter(Boolean).join(', ')
        : undefined;
      return {
        id: String(c._id),
        name: c.name,
        serviceAddress: serviceAddress || undefined,
        pets: petsByClient.get(String(c._id)) ?? [],
      };
    });

    const services: ManualBookingService[] = (
      serviceDocs as unknown as Array<{ _id: unknown; name: string; durationMinutes: number }>
    ).map((s) => ({
      id: String(s._id),
      name: s.name,
      durationMinutes: s.durationMinutes,
    }));

    return { ok: true, clients, services };
  } catch (error) {
    console.error('getManualBookingOptions failed:', error);
    return { ok: false, error: "We couldn't load your clients and services right now." };
  }
}
