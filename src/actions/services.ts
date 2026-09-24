'use server';

/**
 * Service (offering) management server actions for the Groomer Portal.
 *
 * These run only on the server ('use server'). Every action authenticates the
 * caller via NextAuth and scopes each query to the authenticated groomer
 * (`groomerId: session.user.id`) so one groomer can never read or mutate
 * another groomer's services.
 *
 *  - `listServices` returns all of the groomer's services (active + inactive)
 *    for the management page (Requirement 13.1).
 *  - `createService` / `updateService` validate input with `serviceSchema` and
 *    BLOCK persistence when any field is invalid, returning field errors
 *    instead of saving (Requirement 13.1 / 13.2 / 21.1).
 *  - `deleteService` refuses to delete a service that still has UPCOMING
 *    appointments referencing it — where "upcoming" means an appointment whose
 *    status is 'upcoming' or 'in-progress' AND whose scheduled date is in the
 *    future. It returns the blocking count and does NOT delete. A service tied
 *    only to past (or cancelled/completed) appointments deletes normally
 *    (Requirement 13.4).
 *  - `toggleServiceActive` flips the `isActive` flag so a groomer can hide a
 *    service from the public booking flow without deleting it (Requirement 13.5).
 *
 * All actions RETURN a typed result envelope rather than throwing, so the UI
 * can render inline field errors and surface the delete-blocked message as a
 * toast. Mutations revalidate the portal services page and the public booking
 * page so pricing/visibility changes propagate (Requirement 13.3).
 *
 * _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 21.1_
 */
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Service } from '@/lib/db/models/service';
import { Appointment } from '@/lib/db/models/appointment';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import {
  serviceSchema,
  type ServiceFormInput,
} from '@/lib/validators/service';

// ---------------------------------------------------------------------------
// Shared shapes / result envelopes
// ---------------------------------------------------------------------------

/** A serializable service row as returned to the management page. */
export interface ServiceListItem {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  durationMinutes: number;
  isActive: boolean;
}

/** Result envelope returned by {@link listServices}. */
export type ListServicesResult =
  | { ok: true; services: ServiceListItem[] }
  | { ok: false; error: string };

/**
 * Result envelope for create/update. On validation failure `fieldErrors`
 * carries per-field messages so the form can render them inline without
 * clearing valid values (Requirement 21.1).
 */
export type MutateServiceResult =
  | { ok: true; service: ServiceListItem }
  | { ok: false; error?: string; fieldErrors?: Record<string, string[]> };

/**
 * Result envelope for delete. On the blocked path `ok` is false and `error`
 * names the number of upcoming appointments still referencing the service
 * (Requirement 13.4); `upcomingCount` carries the raw number for the UI.
 */
export type DeleteServiceResult =
  | { ok: true }
  | { ok: false; error: string; upcomingCount?: number };

/** Result envelope returned by {@link toggleServiceActive}. */
export type ToggleServiceResult =
  | { ok: true; isActive: boolean }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Statuses that make an appointment "still pending" for delete-guard purposes.
 * Completed and cancelled appointments never block a service delete.
 */
const BLOCKING_STATUSES = ['upcoming', 'in-progress'] as const;

/** Revalidate the portal services page and (when known) the public booking page. */
async function revalidateServiceSurfaces(groomerId: string): Promise<void> {
  // Portal management view.
  revalidatePath('/services');

  // Public booking flow — pricing/visibility must propagate (Requirement 13.3).
  // Resolve the groomer's public slug so we can target the specific route.
  try {
    const profile = await GroomerProfile.findOne({ userId: groomerId })
      .select('groomerSlug')
      .lean();
    if (profile?.groomerSlug) {
      revalidatePath(`/book/${profile.groomerSlug}`);
    }
  } catch {
    // Revalidation is best-effort; a failure here must not fail the mutation.
  }
}

/** Project a Mongoose service document (lean or hydrated) into the list shape. */
function toListItem(doc: {
  _id: unknown;
  name: string;
  description?: string;
  basePrice: number;
  durationMinutes: number;
  isActive: boolean;
}): ServiceListItem {
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description ?? undefined,
    basePrice: doc.basePrice,
    durationMinutes: doc.durationMinutes,
    isActive: doc.isActive,
  };
}

// ---------------------------------------------------------------------------
// listServices
// ---------------------------------------------------------------------------

/**
 * List every service owned by the authenticated groomer (active + inactive),
 * newest first, for the services management page (Requirement 13.1).
 */
export async function listServices(): Promise<ListServicesResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view services.' };
  }

  try {
    await connectDB();

    const docs = await Service.find({ groomerId: session.user.id })
      .sort({ createdAt: -1 })
      .lean();

    return { ok: true, services: docs.map(toListItem) };
  } catch (error) {
    console.error('listServices failed:', error);
    return {
      ok: false,
      error: "We couldn't load your services right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// createService
// ---------------------------------------------------------------------------

/**
 * Validate and create a new service for the authenticated groomer.
 *
 * On invalid input the action returns `{ ok: false, fieldErrors }` and creates
 * nothing (Requirement 13.2 / 21.1). New services default to active so they
 * appear in the public booking flow immediately (Requirement 13.5 inverse).
 */
export async function createService(
  input: ServiceFormInput
): Promise<MutateServiceResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to create a service.' };
  }

  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const data = parsed.data;

  try {
    await connectDB();

    const created = await Service.create({
      groomerId: session.user.id,
      name: data.name,
      description: data.description ? data.description : undefined,
      basePrice: data.basePrice,
      durationMinutes: data.durationMinutes,
      isActive: true,
    });

    await revalidateServiceSurfaces(session.user.id);

    return { ok: true, service: toListItem(created) };
  } catch (error) {
    console.error('createService failed:', error);
    return {
      ok: false,
      error: "We couldn't create the service right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// updateService
// ---------------------------------------------------------------------------

/**
 * Validate and update an existing service owned by the authenticated groomer.
 *
 * On invalid input the action returns field errors and persists nothing
 * (Requirement 13.2 / 21.1). Pricing changes propagate to the public booking
 * flow via revalidation (Requirement 13.3). The `isActive` flag is not touched
 * here — visibility is owned by {@link toggleServiceActive}.
 */
export async function updateService(
  id: string,
  input: ServiceFormInput
): Promise<MutateServiceResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to update a service.' };
  }

  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const data = parsed.data;

  try {
    await connectDB();

    const updated = await Service.findOneAndUpdate(
      { _id: id, groomerId: session.user.id },
      {
        $set: {
          name: data.name,
          description: data.description ? data.description : undefined,
          basePrice: data.basePrice,
          durationMinutes: data.durationMinutes,
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return { ok: false, error: 'Service not found.' };
    }

    await revalidateServiceSurfaces(session.user.id);

    return { ok: true, service: toListItem(updated) };
  } catch (error) {
    console.error('updateService failed:', error);
    return {
      ok: false,
      error: "We couldn't save the service right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// deleteService
// ---------------------------------------------------------------------------

/**
 * Delete a service owned by the authenticated groomer, UNLESS it still has
 * upcoming appointments referencing it.
 *
 * An appointment blocks deletion when its status is 'upcoming' or 'in-progress'
 * AND it is scheduled in the future. When one or more such appointments exist,
 * the action returns `{ ok: false, error, upcomingCount }` and deletes nothing
 * (Requirement 13.4). A service associated only with past, completed, or
 * cancelled appointments deletes normally (Requirement 13.4 second clause).
 */
export async function deleteService(id: string): Promise<DeleteServiceResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to delete a service.' };
  }

  try {
    await connectDB();

    // Ensure the service exists within the groomer's scope before counting.
    const service = await Service.findOne({
      _id: id,
      groomerId: session.user.id,
    })
      .select('_id')
      .lean();

    if (!service) {
      return { ok: false, error: 'Service not found.' };
    }

    // Count blocking appointments: pending status AND scheduled in the future
    // (Requirement 13.4 — only UPCOMING appointments block; past ones do not).
    const upcomingCount = await Appointment.countDocuments({
      groomerId: session.user.id,
      serviceId: id,
      status: { $in: BLOCKING_STATUSES },
      scheduledDate: { $gt: new Date() },
    });

    if (upcomingCount > 0) {
      const noun = upcomingCount === 1 ? 'appointment' : 'appointments';
      return {
        ok: false,
        upcomingCount,
        error: `This service can't be deleted because it has ${upcomingCount} upcoming ${noun}. Mark it inactive to hide it from booking, or cancel those appointments first.`,
      };
    }

    await Service.deleteOne({ _id: id, groomerId: session.user.id });

    await revalidateServiceSurfaces(session.user.id);

    return { ok: true };
  } catch (error) {
    console.error('deleteService failed:', error);
    return {
      ok: false,
      error: "We couldn't delete the service right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// toggleServiceActive
// ---------------------------------------------------------------------------

/**
 * Show or hide a service from the public booking flow by flipping its
 * `isActive` flag, without deleting it (Requirement 13.5). Visibility changes
 * propagate to the public booking page via revalidation (Requirement 13.3).
 */
export async function toggleServiceActive(
  id: string,
  isActive: boolean
): Promise<ToggleServiceResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to update a service.' };
  }

  try {
    await connectDB();

    const result = await Service.updateOne(
      { _id: id, groomerId: session.user.id },
      { $set: { isActive } }
    );

    if (result.matchedCount === 0) {
      return { ok: false, error: 'Service not found.' };
    }

    await revalidateServiceSurfaces(session.user.id);

    return { ok: true, isActive };
  } catch (error) {
    console.error('toggleServiceActive failed:', error);
    return {
      ok: false,
      error: "We couldn't update the service right now. Please try again.",
    };
  }
}
