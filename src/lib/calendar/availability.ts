/**
 * Availability slot computation.
 *
 * Given a groomer's recurring weekly availability windows and all sources of
 * blocked time (existing appointments, manually blocked dates, and
 * Google-Calendar-derived blocks stored locally), this module computes the
 * concrete, bookable time slots for a date range.
 *
 * The logic is split into two layers so the core business rules can be unit-
 * and property-tested without a database:
 *
 *   - `generateCandidateSlots` / `hasConflict` — PURE, DB-free helpers that
 *     contain all the slot-generation and overlap logic.
 *   - `getAvailableSlots` — the DB-backed orchestrator that loads the profile,
 *     appointments, blocked dates, and calendar blocks, then delegates to the
 *     pure core and filters to future, available slots.
 *
 * dayOfWeek convention: 0 = Monday .. 6 = Sunday, derived from a JS Date via
 * `(date.getDay() + 6) % 7` (JS getDay() returns 0 = Sunday).
 *
 * _Requirements: 6.1, 6.2_
 */
import { eachDayOfInterval, isAfter, isBefore, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import type { AvailabilityQuery, TimeSlot } from '@/types';

const SLOT_INCREMENT_MINUTES = 15;
const MS_PER_MINUTE = 60 * 1000;

/**
 * A recurring weekly availability window.
 * `dayOfWeek` uses the 0 = Monday convention; times are "HH:mm" strings in
 * 15-minute increments (e.g. "09:00", "17:30").
 */
export interface AvailabilityWindowInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * A time-bounded block from any source (appointment, blocked date, or Google
 * Calendar event). The pure core normalises every source to this shape so it
 * does not need to know about the differing field names used by each Mongoose
 * model.
 */
export interface TimeBlock {
  start: Date;
  end: Date;
}

/**
 * Two half-open intervals [start, end) overlap iff each starts before the
 * other ends. Adjacent intervals that merely touch at an endpoint (e.g. one
 * ends exactly when the next begins) do NOT overlap.
 */
function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return isBefore(startA, endB) && isAfter(endA, startB);
}

/**
 * Returns true if the interval [start, end) overlaps any block drawn from any
 * of the provided block sources. Each source is a list of {@link TimeBlock}s.
 *
 * Accepts multiple sources so callers can pass appointments, blocked dates,
 * and Google blocks as separate arrays without merging them first.
 *
 * PURE / DB-free — safe to call from tests.
 */
export function hasConflict(
  start: Date,
  end: Date,
  ...blockSources: TimeBlock[][]
): boolean {
  for (const source of blockSources) {
    for (const block of source) {
      if (overlaps(start, end, block.start, block.end)) return true;
    }
  }
  return false;
}

/**
 * Generates every candidate slot across [startDate, endDate] from the given
 * recurring windows, in {@link SLOT_INCREMENT_MINUTES}-minute increments, each
 * `serviceDurationMinutes` long, marking each slot available or not based on
 * whether it conflicts with any provided block.
 *
 * This is the pure heart of availability computation: no database, no clock,
 * fully deterministic given its inputs. Property tests (tasks 5.5, 5.6) should
 * import this to verify that returned slots never overlap blocked time and
 * always respect the requested service duration.
 *
 * Note: this returns ALL candidate slots (available and unavailable) and does
 * NOT filter to the future — that responsibility belongs to the orchestrator
 * so the core stays clock-independent and testable.
 *
 * @param windows Recurring weekly windows (0 = Monday).
 * @param blocks  All blocked intervals to check against, from any source.
 * @param startDate Inclusive first day of the range.
 * @param endDate   Inclusive last day of the range.
 * @param serviceDurationMinutes Length of each slot, in minutes.
 */
export function generateCandidateSlots(
  windows: AvailabilityWindowInput[],
  blocks: TimeBlock[],
  startDate: Date,
  endDate: Date,
  serviceDurationMinutes: number
): TimeSlot[] {
  const slots: TimeSlot[] = [];

  // A non-positive duration can never yield a valid slot.
  if (serviceDurationMinutes <= 0) return slots;
  // An inverted range has no days to iterate.
  if (isAfter(startDate, endDate)) return slots;

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const durationMs = serviceDurationMinutes * MS_PER_MINUTE;
  const incrementMs = SLOT_INCREMENT_MINUTES * MS_PER_MINUTE;

  for (const day of days) {
    const dayOfWeek = (day.getDay() + 6) % 7; // 0 = Monday
    const dayWindows = windows.filter((w) => w.dayOfWeek === dayOfWeek);

    for (const window of dayWindows) {
      const [startH, startM] = window.startTime.split(':').map(Number);
      const [endH, endM] = window.endTime.split(':').map(Number);

      // Anchor window boundaries to this specific day, zeroing sub-minute parts.
      let slotStart = setMilliseconds(setSeconds(setMinutes(setHours(day, startH), startM), 0), 0);
      const windowEnd = setMilliseconds(setSeconds(setMinutes(setHours(day, endH), endM), 0), 0);

      while (true) {
        const slotEnd = new Date(slotStart.getTime() + durationMs);
        // Stop once a full-duration slot would run past the window's end.
        if (isAfter(slotEnd, windowEnd)) break;

        const blocked = hasConflict(slotStart, slotEnd, blocks);
        slots.push({ start: slotStart, end: slotEnd, available: !blocked });

        slotStart = new Date(slotStart.getTime() + incrementMs);
      }
    }
  }

  return slots;
}

/**
 * DB-backed orchestrator. Loads the groomer's profile, in-range appointments
 * (upcoming / in-progress only), overlapping manually blocked dates, and
 * locally-stored Google Calendar blocks, then delegates slot generation to the
 * pure {@link generateCandidateSlots} and returns only slots that are both
 * available AND in the future.
 *
 * _Requirements: 6.1, 6.2_
 */
export async function getAvailableSlots(query: AvailabilityQuery): Promise<TimeSlot[]> {
  // Imported lazily so the pure helpers above can be used without pulling in
  // Mongoose / a DB connection (keeps the tested core DB-free).
  const { connectDB } = await import('@/lib/db/connect');
  const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
  const { Appointment } = await import('@/lib/db/models/appointment');
  const { CalendarBlock } = await import('@/lib/db/models/calendar-block');

  const { groomerId, startDate, endDate, serviceDurationMinutes } = query;

  await connectDB();

  // 1. Groomer's recurring windows + configured blocked dates.
  const profile = await GroomerProfile.findOne({ userId: groomerId }).lean();
  if (!profile) return [];

  // 2. Existing appointments in range that still occupy time.
  const appointments = await Appointment.find({
    groomerId,
    scheduledDate: { $gte: startDate, $lte: endDate },
    status: { $in: ['upcoming', 'in-progress'] },
  }).lean();

  // 3. Manually blocked dates overlapping the range.
  const blockedDates = (profile.blockedDates ?? []).filter(
    (b) => isBefore(new Date(b.startDateTime), endDate) && isAfter(new Date(b.endDateTime), startDate)
  );

  // 4. Google Calendar blocks stored locally from sync, overlapping the range.
  //    Includes both per-groomer blocks and shared-calendar blocks (the
  //    service-account model writes shared-calendar rows with no groomerId).
  const googleBlocks = await CalendarBlock.find({
    $or: [{ groomerId }, { source: 'shared-calendar' }],
    startTime: { $lte: endDate },
    endTime: { $gte: startDate },
  }).lean();

  // Normalise every source to the { start, end } shape the pure core expects.
  const blocks: TimeBlock[] = [
    ...appointments.map((a) => ({ start: new Date(a.scheduledDate), end: new Date(a.scheduledEndDate) })),
    ...blockedDates.map((b) => ({ start: new Date(b.startDateTime), end: new Date(b.endDateTime) })),
    ...googleBlocks.map((g) => ({ start: new Date(g.startTime), end: new Date(g.endTime) })),
  ];

  const windows: AvailabilityWindowInput[] = (profile.availabilityWindows ?? []).map((w) => ({
    dayOfWeek: w.dayOfWeek,
    startTime: w.startTime,
    endTime: w.endTime,
  }));

  const candidates = generateCandidateSlots(
    windows,
    blocks,
    startDate,
    endDate,
    serviceDurationMinutes
  );

  const now = new Date();
  return candidates.filter((s) => s.available && isAfter(s.start, now));
}
