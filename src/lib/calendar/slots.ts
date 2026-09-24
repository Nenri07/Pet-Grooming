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

/**
 * ROUTING SEAM (§10). Phase 3 will filter/rank slots by route fit (detour
 * minutes, service radius) once the client's geocoded address is known. Until
 * then this is an identity pass so the pipeline is wired end-to-end.
 *
 * Do not remove — Phase 3 replaces the body, not the call site.
 */
export function applyRoutingFilter(slots: TimeSlot[]): TimeSlot[] {
  // TODO(phase-3): drop slots whose detour > maxDetourMin; rank/label the rest.
  return slots;
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

  // Step 5: routing seam (no-op in Phase 2).
  return applyRoutingFilter(bookable);
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
  now: Date = new Date()
): Promise<TimeSlot[]> {
  const cacheKey = keys.avail(groomerId, dateStr);

  if (isRedisConfigured()) {
    const cached = await cacheGet<Array<{ start: string; end: string; available: boolean }>>(
      cacheKey
    );
    if (cached) {
      return cached.map((s) => ({
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

  const slots = computeSlotsForDate({
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
      slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        available: s.available,
      })),
      TTL.AVAIL
    );
  }

  return slots;
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
