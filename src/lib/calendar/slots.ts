/**
 * Native slot generation (Master Spec §9.3).
 *
 * Composes the existing pure availability core (`availability.ts`) with the new
 * Redis hold layer (`holds.ts`) and a 60-second Redis cache:
 *
 *   1. Build working intervals per day = weekly windows − blocks.
 *   2. Subtract existing appointments (status ≠ cancelled) padded by `bufferMin`,
 *      plus manual blocked dates.
 *   3. Subtract ACTIVE Redis holds.
 *   4. Generate candidate starts every `slotStepMin`; keep those that fit and
 *      respect `minNoticeHours`.
 *   5. Routing filter / ranking (§10) — a NO-OP seam here, filled in Phase 3.
 *   6. Cache the result per `(groomerId, dateStr)` in Redis for 60 s, with
 *      {@link invalidateSlotsCache} to bust it on any relevant change.
 *
 * The pure heart — {@link computeSlotsForDate} — takes plain inputs and needs
 * no Redis or DB, so it is directly unit-testable.
 *
 * _Master Spec: §9.3, §10 (seam)_
 */
import {
  generateCandidateSlots,
  type AvailabilityWindowInput,
  type TimeBlock,
} from '@/lib/calendar/availability';
import { holdsToBlocks, type ActiveHold } from '@/lib/calendar/holds';
import { cacheGet, cacheSet, cacheDel, keys, TTL, isRedisConfigured } from '@/lib/redis';
import {
  evaluateInsertion,
  scoreInsertion,
  labelForScore,
  exceedsMaxDetour,
  isWithinServiceRadius,
  getTravelProvider,
  haversineKm,
  ROUTING,
  type LatLng,
  type Stop,
  type TravelProvider,
  type TravelCfg,
} from '@/lib/routing';
import type { TimeSlot } from '@/types';

const MS_PER_MINUTE = 60 * 1000;

/** Tuning knobs pulled from GroomerProfile (§9.2 defaults applied by caller). */
export interface SlotConfig {
  bufferMin: number;
  slotStepMin: number;
  minNoticeHours: number;
}

/** Inputs to the pure slot computation for a single day. */
export interface ComputeSlotsInput {
  /** Recurring weekly windows (0 = Monday). */
  windows: AvailabilityWindowInput[];
  /** Existing appointment blocks (already status-filtered by the caller). */
  appointmentBlocks: TimeBlock[];
  /** Manual blocked-date blocks. */
  blockedDates: TimeBlock[];
  /** Active Redis holds for the day. */
  holds: ActiveHold[];
  /** The day to generate slots for. */
  date: Date;
  /** Service duration in minutes. */
  serviceDurationMinutes: number;
  /** Config knobs. */
  config: SlotConfig;
  /** "Now" used for the min-notice cutoff (injected for testability). */
  now: Date;
}

/** Pad a block on both sides by `bufferMin` minutes. PURE. */
function padBlock(block: TimeBlock, bufferMin: number): TimeBlock {
  const padMs = bufferMin * MS_PER_MINUTE;
  return {
    start: new Date(block.start.getTime() - padMs),
    end: new Date(block.end.getTime() + padMs),
  };
}

/** Routing inputs threaded through when the client's location is known (§10.5). */
export interface RoutingInput {
  /** Groomer base location (start/end of day). */
  base: LatLng;
  /** The candidate client's geocoded location. `null` → routing is a pass-through. */
  clientLoc: LatLng | null;
  /** That day's existing non-cancelled appointment stops. */
  stops: Stop[];
  /** The working-day window in epoch ms (for feasibility + round-trip). */
  dayWindow: { startMs: number; endMs: number };
  /** Groomer routing config. */
  config: {
    bufferMin: number;
    maxDetourMin?: number;
    serviceRadiusKm?: number;
    travel: TravelCfg;
  };
  /**
   * Perspective: 'client' hides over-detour / out-of-radius slots; 'groomer'
   * keeps everything (manual add) but still scores/labels. Default 'client'.
   */
  view?: 'client' | 'groomer';
  /** Travel provider override (defaults to the haversine provider). */
  travelProvider?: TravelProvider;
}

/** True when the day already has >= 2 stops within `clusterKm` of each other (§10.4). */
function isClusterDay(stops: Stop[], clusterKm = ROUTING.clusterKm): boolean {
  let close = 0;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (haversineKm(stops[i].loc, stops[j].loc) <= clusterKm) {
        close += 1;
        if (close >= 2) return true;
      }
    }
  }
  return false;
}

/**
 * ROUTING FILTER (§10.5). Ranks and labels slots by route fit and drops the
 * ones a client shouldn't see.
 *
 * CRITICAL: when the client location is UNKNOWN (`clientLoc == null`, e.g. no
 * geocoder configured), routing is a PASS-THROUGH — all slots are returned
 * unranked so booking still works. The default provider is pure haversine, so
 * no Mapbox account is needed.
 *
 * For each candidate slot with a known location: runs {@link evaluateInsertion}
 * + {@link scoreInsertion}, attaches `{ score, label, extraDriveMin, fromPrevKm }`,
 * drops slots outside the service radius (both views) and — for the client view
 * — slots whose detour exceeds `maxDetourMin`, then sorts by score desc
 * ("Best fit" first).
 */
export async function applyRoutingFilter(
  slots: TimeSlot[],
  routing?: RoutingInput
): Promise<TimeSlot[]> {
  // No routing context or unknown client location → pass-through (unranked).
  if (!routing || !routing.clientLoc) return slots;

  const { base, clientLoc, stops, dayWindow, config, view = 'client' } = routing;
  const tp = routing.travelProvider ?? getTravelProvider(config.travel);
  const clusterDay = isClusterDay(stops);

  const annotated: TimeSlot[] = [];

  for (const slot of slots) {
    const result = await evaluateInsertion(
      stops,
      base,
      { loc: clientLoc, startMs: slot.start.getTime(), endMs: slot.end.getTime() },
      { bufferMin: config.bufferMin },
      tp,
      dayWindow
    );

    // Infeasible insertion → not bookable at all.
    if (!result) continue;

    // Hard filter: outside the service radius is never bookable (either view).
    if (!isWithinServiceRadius(result.fromPrevKm, config.serviceRadiusKm)) continue;

    // Client view hides over-detour slots; groomer view keeps them.
    if (view === 'client' && exceedsMaxDetour(result.extraDriveMin, config.maxDetourMin)) continue;

    const score = scoreInsertion(result, { clusterDay });
    const label = labelForScore(score, result.extraDriveMin);

    annotated.push({
      ...slot,
      score,
      label,
      extraDriveMin: result.extraDriveMin,
      fromPrevKm: result.fromPrevKm,
    });
  }

  // "Best fit" first: sort by score descending; unscored slots sink.
  annotated.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return annotated;
}

/**
 * PURE core: compute bookable slots for one day. No Redis, no DB, no ambient
 * clock — everything comes in via {@link ComputeSlotsInput}.
 *
 * Returns only slots that are available, in the future, and at least
 * `minNoticeHours` away from `now`.
 */
export function computeSlotsForDate(input: ComputeSlotsInput): TimeSlot[] {
  const {
    windows,
    appointmentBlocks,
    blockedDates,
    holds,
    date,
    serviceDurationMinutes,
    config,
    now,
  } = input;

  // Steps 2–3: assemble all blocking intervals. Appointments are padded by the
  // buffer; blocked dates and holds are hard blocks as-is.
  const blocks: TimeBlock[] = [
    ...appointmentBlocks.map((b) => padBlock(b, config.bufferMin)),
    ...blockedDates,
    ...holdsToBlocks(holds),
  ];

  // Step 4: generate candidates every slotStepMin over this single day.
  const candidates = generateCandidateSlots(
    windows,
    blocks,
    date,
    date,
    serviceDurationMinutes
  );

  // Min-notice cutoff: earliest allowed start.
  const noticeCutoff = new Date(now.getTime() + config.minNoticeHours * 60 * MS_PER_MINUTE);

  const bookable = candidates.filter(
    (s) => s.available && s.start.getTime() >= noticeCutoff.getTime()
  );

  // Step 5 (routing filter/ranking, §10) is applied by the orchestrator via the
  // async {@link applyRoutingFilter}, since it depends on a travel provider and
  // the client's geocoded location. The pure core stays sync + DB/Redis-free
  // and returns the unranked bookable set.
  return bookable;
}

/**
 * DB + Redis orchestrator: compute slots for a single `dateStr` (`yyyy-mm-dd`),
 * caching the result for 60 s. Loads the profile, in-range non-cancelled
 * appointments, blocked dates, and active holds, then delegates to the pure
 * {@link computeSlotsForDate}.
 *
 * When Redis is unconfigured the cache is skipped transparently (compute only).
 */
export async function getSlotsForDate(
  groomerId: string,
  dateStr: string,
  serviceDurationMinutes: number,
  now: Date = new Date(),
  /**
   * Optional Order Radar inputs (§10.5). When `clientLoc` is provided AND the
   * groomer has a `baseLocation`, slots are ranked/labelled and over-detour /
   * out-of-radius slots are dropped for the client view. When omitted or the
   * location is unknown, the base (unranked) slots are returned unchanged so
   * booking always works.
   */
  routingOpts?: { clientLoc?: LatLng | null; view?: 'client' | 'groomer' }
): Promise<TimeSlot[]> {
  const cacheKey = keys.avail(groomerId, dateStr);

  // The 60s cache holds the ROUTING-FREE base slots (routing is client-specific,
  // so it is layered on top after retrieval). This keeps the cache reusable
  // across clients.
  let baseSlots: TimeSlot[] | null = null;

  if (isRedisConfigured()) {
    const cached = await cacheGet<Array<{ start: string; end: string; available: boolean }>>(
      cacheKey
    );
    if (cached) {
      baseSlots = cached.map((s) => ({
        start: new Date(s.start),
        end: new Date(s.end),
        available: s.available,
      }));
    }
  }

  // Lazy imports keep the pure core importable without Mongoose.
  const { connectDB } = await import('@/lib/db/connect');
  const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
  const { Appointment } = await import('@/lib/db/models/appointment');
  const { getActiveHolds } = await import('@/lib/calendar/holds');

  await connectDB();

  const profile = await GroomerProfile.findOne({ userId: groomerId }).lean();
  if (!profile) return [];

  // Day bounds in UTC (Phase 2 keeps math simple; timezone handling arrives with
  // the Availability model migration).
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  const appointments = await Appointment.find({
    groomerId,
    scheduledDate: { $gte: dayStart, $lte: dayEnd },
    status: { $ne: 'cancelled' },
  }).lean();

  const appointmentBlocks: TimeBlock[] = appointments.map((a) => ({
    start: new Date(a.scheduledDate),
    end: new Date(a.scheduledEndDate),
  }));

  // Compute the routing-free base slots only when not served from cache.
  if (!baseSlots) {
    const blockedDates: TimeBlock[] = (profile.blockedDates ?? [])
      .filter(
        (b) =>
          new Date(b.startDateTime).getTime() <= dayEnd.getTime() &&
          new Date(b.endDateTime).getTime() >= dayStart.getTime()
      )
      .map((b) => ({ start: new Date(b.startDateTime), end: new Date(b.endDateTime) }));

    const holds = await getActiveHolds(groomerId, dateStr);

    const windows: AvailabilityWindowInput[] = (profile.availabilityWindows ?? []).map((w) => ({
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
    }));

    const config: SlotConfig = {
      bufferMin: profile.bufferMin ?? 10,
      slotStepMin: profile.slotStepMin ?? 15,
      minNoticeHours: profile.minNoticeHours ?? 12,
    };

    baseSlots = computeSlotsForDate({
      windows,
      appointmentBlocks,
      blockedDates,
      holds,
      date: dayStart,
      serviceDurationMinutes,
      config,
      now,
    });

    if (isRedisConfigured()) {
      await cacheSet(
        cacheKey,
        baseSlots.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          available: s.available,
        })),
        TTL.AVAIL
      );
    }
  }

  // Step 5 (§10.5): layer routing on top of the base slots when the client's
  // location is known and the groomer has a base location. Otherwise return the
  // base slots unchanged — booking must always work with an unknown location.
  const clientLoc = routingOpts?.clientLoc ?? null;
  if (clientLoc && profile.baseLocation) {
    const stops: Stop[] = appointments.map((a) => ({
      id: String(a._id),
      loc: a.location ?? profile.baseLocation!, // fall back to base if a stop lacks coords
      startMs: new Date(a.scheduledDate).getTime(),
      endMs: new Date(a.scheduledEndDate).getTime(),
    }));

    return applyRoutingFilter(baseSlots, {
      base: profile.baseLocation,
      clientLoc,
      stops,
      dayWindow: { startMs: dayStart.getTime(), endMs: dayEnd.getTime() },
      config: {
        bufferMin: profile.bufferMin ?? ROUTING.bufferMin,
        maxDetourMin: profile.maxDetourMin ?? ROUTING.maxDetourMin,
        serviceRadiusKm: profile.serviceRadiusKm,
        travel: {
          roadFactor: profile.roadFactor ?? ROUTING.travel.roadFactor,
          avgSpeedKmh: profile.avgSpeedKmh ?? ROUTING.travel.avgSpeedKmh,
          parkingMin: profile.parkingMin ?? ROUTING.travel.parkingMin,
        },
      },
      view: routingOpts?.view ?? 'client',
    });
  }

  return baseSlots;
}

/**
 * Invalidate the cached slots for a groomer. Pass a `dateStr` to bust one day;
 * omit it and the caller is responsible for busting each affected day (Upstash
 * has no cheap wildcard delete, so we require explicit dates from callers that
 * know which day changed). No-op when Redis is unconfigured.
 *
 * _Master Spec: §9.3 step 6 (invalidate on any appointment/availability/hold change)_
 */
export async function invalidateSlotsCache(
  groomerId: string,
  dateStr?: string
): Promise<void> {
  if (!isRedisConfigured()) return;
  if (dateStr) {
    await cacheDel(keys.avail(groomerId, dateStr));
  }
  // Without a specific date there is nothing safe/cheap to delete on Upstash;
  // callers that mutate a specific day should always pass that day's dateStr.
}
