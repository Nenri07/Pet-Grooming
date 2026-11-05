'use server';

/**
 * Public availability server action.
 *
 * Backs Step 4 of the public booking flow. Given a groomer's public booking
 * slug and the estimated service duration, it resolves the groomer's id from
 * the slug, computes the [now, now + 14 days] window (Requirement 6.1), and
 * delegates to the DB-backed {@link getAvailableSlots} engine.
 *
 * Design decisions:
 *  - The action RETURNS a typed result envelope rather than throwing, so the UI
 *    can distinguish "here are your slots" (possibly empty → no-availability
 *    message, Requirement 6.5) from "something went wrong".
 *  - `TimeSlot` carries `Date` objects, which do not survive the server→client
 *    boundary as `Date`s. The action therefore returns slots with ISO-string
 *    `start`/`end`; the client rehydrates them back into `Date`s before
 *    dispatching `SELECT_SLOT` (whose payload must be a real {@link TimeSlot}).
 *
 * _Requirements: 6.1, 6.4, 6.5_
 */
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { getAvailableSlots } from '@/lib/calendar/availability';

/** The number of calendar days of availability to display (Requirement 6.1). */
const AVAILABILITY_WINDOW_DAYS = 14;

/**
 * A time slot serialized for transport across the server→client boundary.
 * `start` / `end` are ISO-8601 strings (the client rehydrates them to `Date`).
 */
export interface SerializedTimeSlot {
  start: string;
  end: string;
  available: boolean;
  /** "Best fit" / "Nearby stop" when the slot sits well on the groomer's route. */
  label?: string | null;
  /** Extra driving this slot adds for the groomer, minutes. */
  extraDriveMin?: number;
}

/** Input accepted by {@link getPublicAvailability}. */
export interface GetPublicAvailabilityInput {
  /** The groomer's public booking slug. */
  groomerSlug: string;
  /** The estimated service duration, in minutes. */
  serviceDurationMinutes: number;
  /** Exact pin from the map picker, when the client used it. */
  location?: { lat: number; lng: number } | null;
  /** Typed service address (geocoded when there is no pin). */
  address?: { street: string; city: string; state: string; postalCode: string } | null;
}

/**
 * Result envelope returned by {@link getPublicAvailability}.
 *
 * - On success: `ok` is true and `slots` holds the (possibly empty) list of
 *   available, future slots serialized for the client. An empty list is a
 *   valid success and drives the no-availability message (Requirement 6.5).
 * - On failure: `ok` is false and `error` holds a user-facing message.
 */
export type GetPublicAvailabilityResult =
  | {
      ok: true;
      slots: SerializedTimeSlot[];
      /** Slots were ranked against the groomer's route for this address. */
      routed?: boolean;
      /** The address is outside the groomer's service area. */
      outsideArea?: boolean;
    }
  | { ok: false; error: string };

/** Whether a value is a usable positive, finite duration in minutes. */
function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Compute available booking slots for the next 14 days for a groomer's public
 * booking page.
 *
 * Resolves the groomer id from the slug, builds the [now, now + 14 days]
 * window, and returns the available future slots. Returns an error envelope
 * (rather than throwing) so the UI can render a message and let the client
 * retry.
 */
export async function getPublicAvailability(
  input: GetPublicAvailabilityInput
): Promise<GetPublicAvailabilityResult> {
  const { groomerSlug, serviceDurationMinutes } = input;

  // Guard: a non-positive / missing duration can never yield a valid slot.
  if (!isPositiveFinite(serviceDurationMinutes)) {
    return {
      ok: false,
      error: "We couldn't load available times because the service duration is missing.",
    };
  }

  try {
    await connectDB();

    // 1. Resolve the groomer id from the public slug.
    const profile = await GroomerProfile.findOne({ groomerSlug })
      .select(
        'userId baseLocation bufferMin maxDetourMin serviceRadiusKm serviceAreaPolygon roadFactor avgSpeedKmh parkingMin'
      )
      .lean();

    if (!profile) {
      return {
        ok: false,
        error: "We couldn't load available times because this groomer is unavailable.",
      };
    }

    // 2. Compute the [now, now + 14 days] window (Requirement 6.1).
    const startDate = new Date();
    const endDate = new Date(startDate.getTime());
    endDate.setDate(endDate.getDate() + AVAILABILITY_WINDOW_DAYS);

    // 3. Delegate to the availability engine.
    const slots = await getAvailableSlots({
      groomerId: profile.userId.toString(),
      startDate,
      endDate,
      serviceDurationMinutes,
    });

    // 4. Route-aware ranking: label slots that fit the groomer's day and drop
    //    ones outside the service area / over the max detour. Best-effort —
    //    any failure falls back to the plain list so booking always works.
    let finalSlots = slots;
    let routed = false;
    let outsideArea = false;
    if (profile.baseLocation && slots.length > 0 && (input.location || input.address)) {
      try {
        const routedResult = await routeSlots(String(profile.userId), profile, slots, input);
        if (routedResult) {
          routed = true;
          finalSlots = routedResult;
          outsideArea = routedResult.length === 0;
        }
      } catch (err) {
        console.error('getPublicAvailability: routing failed (falling back):', err);
      }
    }

    // 5. Serialize dates for the client boundary.
    return {
      ok: true,
      routed,
      outsideArea,
      slots: finalSlots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        available: s.available,
        label: s.label ?? null,
        extraDriveMin: s.extraDriveMin,
      })),
    };
  } catch (error) {
    console.error('getPublicAvailability failed:', error);
    return {
      ok: false,
      error: "We couldn't load available times right now. Please try again.",
    };
  }
}

type RoutingProfile = {
  baseLocation?: { lat: number; lng: number } | null;
  bufferMin?: number;
  maxDetourMin?: number;
  serviceRadiusKm?: number;
  serviceAreaPolygon?: unknown;
  roadFactor?: number;
  avgSpeedKmh?: number;
  parkingMin?: number;
};

/**
 * Rank and filter slots against each day's stops for the client's location.
 * Returns null when the location can't be resolved (caller keeps the plain list).
 */
async function routeSlots(
  groomerId: string,
  profile: RoutingProfile,
  slots: import('@/types').TimeSlot[],
  input: GetPublicAvailabilityInput
): Promise<import('@/types').TimeSlot[] | null> {
  const { sanitizeLatLng } = await import('@/lib/geo/mapbox-search');
  const { geocodeStructured, ROUTING } = await import('@/lib/routing');
  const { applyRoutingFilter } = await import('@/lib/calendar/slots');
  const { Appointment } = await import('@/lib/db/models/appointment');

  const clientLoc =
    sanitizeLatLng(input.location) ?? (input.address ? await geocodeStructured(input.address) : null);
  if (!clientLoc || !profile.baseLocation) return null;

  // Group by UTC day (matches the slot engine's day bounds).
  const byDay = new Map<string, import('@/types').TimeSlot[]>();
  for (const sl of slots) {
    const key = sl.start.toISOString().slice(0, 10);
    const list = byDay.get(key) ?? [];
    list.push(sl);
    byDay.set(key, list);
  }

  const dayKeys = Array.from(byDay.keys());
  const rangeStart = new Date(`${dayKeys[0]}T00:00:00.000Z`);
  const rangeEnd = new Date(`${dayKeys[dayKeys.length - 1]}T23:59:59.999Z`);
  const appts = await Appointment.find({
    groomerId,
    status: { $ne: 'cancelled' },
    scheduledDate: { $gte: rangeStart, $lte: rangeEnd },
  })
    .select('_id location scheduledDate scheduledEndDate')
    .lean<Array<{ _id: unknown; location?: { lat: number; lng: number }; scheduledDate: Date; scheduledEndDate: Date }>>();

  const out: import('@/types').TimeSlot[] = [];
  for (const key of dayKeys) {
    const dayStart = new Date(`${key}T00:00:00.000Z`);
    const dayEnd = new Date(`${key}T23:59:59.999Z`);
    const stops = appts
      .filter((a) => {
        const t = new Date(a.scheduledDate).getTime();
        return t >= dayStart.getTime() && t <= dayEnd.getTime();
      })
      .map((a) => ({
        id: String(a._id),
        loc: a.location ?? profile.baseLocation!,
        startMs: new Date(a.scheduledDate).getTime(),
        endMs: new Date(a.scheduledEndDate).getTime(),
      }));
    const ranked = await applyRoutingFilter(byDay.get(key)!, {
      base: profile.baseLocation,
      clientLoc,
      stops,
      dayWindow: { startMs: dayStart.getTime(), endMs: dayEnd.getTime() },
      config: {
        bufferMin: profile.bufferMin ?? ROUTING.bufferMin,
        maxDetourMin: profile.maxDetourMin ?? ROUTING.maxDetourMin,
        serviceRadiusKm: profile.serviceRadiusKm,
        serviceAreaPolygon: (profile.serviceAreaPolygon ?? null) as import('@/lib/routing/service-area').GeoPolygon | null,
        travel: {
          roadFactor: profile.roadFactor ?? ROUTING.travel.roadFactor,
          avgSpeedKmh: profile.avgSpeedKmh ?? ROUTING.travel.avgSpeedKmh,
          parkingMin: profile.parkingMin ?? ROUTING.travel.parkingMin,
        },
      },
      view: 'client',
    });
    // Keep the day in time order; the label carries the ranking.
    ranked.sort((a, b) => a.start.getTime() - b.start.getTime());
    out.push(...ranked);
  }
  return out;
}
