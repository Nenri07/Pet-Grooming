/**
 * Trial math — the pure core for the 14-day no-card trial (Phase 1).
 *
 * Two pure functions, no I/O: they take plain `Date`/`string` inputs and an
 * explicit `now`, so they are directly unit- and property-testable. Nothing
 * here imports Mongoose, Stripe, or Redis — the orchestrating action
 * (`src/actions/trial.ts`) stores the results these functions compute.
 *
 * Timezone handling uses `date-fns-tz` **v3** (`fromZonedTime` / `toZonedTime`,
 * the v3 replacements for v2's `zonedTimeToUtc` / `utcToZonedTime`), already a
 * project dependency. Both functions treat the trial clock in the groomer's
 * IANA timezone so a trial that starts late at night and one that starts early
 * the next morning don't land on different calendar days.
 *
 * _Requirements: 1.2 (deadline = noon on day 14 in the groomer tz), 2.1 / 2.2
 * (days remaining, computed in the groomer tz), 2.4 (never negative; 0 once the
 * deadline has passed)._
 * _Design: Pure Functions → `src/lib/billing/trial.ts`._
 */
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The hour-of-day (local wall-clock) the trial ends on — noon. Picking noon
 * rather than midnight keeps the deadline unambiguous across the two DST
 * transitions a year (there is no "missing" or "doubled" 12:00 in the standard
 * US/EU spring-forward and fall-back rules), which midnight cannot guarantee.
 */
const TRIAL_DEADLINE_HOUR = 12;

/** The trial length in whole calendar days (R1.2). */
const TRIAL_LENGTH_DAYS = 14;

/**
 * Resolve a usable IANA timezone, falling back to `'UTC'` when the supplied
 * value is falsy or not a timezone the host's `Intl` engine recognizes.
 *
 * `date-fns-tz` returns `NaN` offsets for an unknown zone rather than throwing,
 * which would silently corrupt the math — so we validate up front with
 * `Intl.DateTimeFormat` and degrade to UTC (R: safe degradation).
 */
function safeTimezone(timezone: string): string {
  if (!timezone) return 'UTC';
  try {
    // Throws a RangeError for an invalid IANA zone id.
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

/**
 * Compute the precise trial deadline: the instant corresponding to 12:00:00.000
 * (noon) local wall-clock time, in `timezone`, on the 14th day after the local
 * start date (R1.2).
 *
 * The computation is done entirely on the local wall-clock calendar so DST
 * shifts never move the deadline off noon:
 *   1. Project `startedAt` into `timezone` to read its local calendar date.
 *   2. Advance that local date by {@link TRIAL_LENGTH_DAYS} days.
 *   3. Pin the local time to {@link TRIAL_DEADLINE_HOUR}:00:00.000.
 *   4. Convert that local wall-clock back to the equivalent UTC instant.
 *
 * Pure: `(startedAt, timezone) -> Date`. Returns a UTC `Date` (as all JS
 * `Date`s are instants). A falsy/invalid `timezone` falls back to `'UTC'`.
 *
 * @param startedAt The instant the trial started.
 * @param timezone  The groomer's configured IANA timezone (e.g. `America/New_York`).
 * @returns The UTC instant of noon-local on start-local-date + 14 days.
 */
export function computeTrialDeadline(startedAt: Date, timezone: string): Date {
  const tz = safeTimezone(timezone);

  // Local wall-clock view of the start instant in the target timezone.
  const local = toZonedTime(startedAt, tz);

  // Advance the local calendar date by the trial length. Using the local
  // date-parts (not epoch arithmetic) keeps us anchored to the calendar day,
  // so a DST day that is 23 or 25 hours long still advances exactly N days.
  const deadlineLocal = new Date(
    local.getFullYear(),
    local.getMonth(),
    local.getDate() + TRIAL_LENGTH_DAYS,
    TRIAL_DEADLINE_HOUR,
    0,
    0,
    0
  );

  // Interpret those local wall-clock parts as a time in `tz` and get the UTC
  // instant. `fromZonedTime` is the v3 name for v2's `zonedTimeToUtc`.
  return fromZonedTime(deadlineLocal, tz);
}

/**
 * Whole number of trial days remaining until `deadline`, measured from `now`
 * (R2.1, R2.2). Never negative — returns `0` the moment `now >= deadline`
 * (R2.4), so the UI shows a "trial ended" state rather than a negative or
 * rolling-over countdown.
 *
 * Rounding choice: the remaining time is rounded **up** (`Math.ceil`) to a whole
 * day. A trial with ~2.3 days left therefore reports `3`, matching how people
 * read a countdown ("3 days left" until the clock actually crosses into the
 * next lower bucket). Concretely:
 *   - `now` exactly at the deadline  -> `0`
 *   - `now` any time after           -> `0`
 *   - just under 1 day remaining     -> `1`
 *   - just under 3 days remaining    -> `3`
 * The result is monotonically non-increasing as `now` advances, which the
 * countdown relies on.
 *
 * The `timezone` argument makes the comparison explicit and keeps the signature
 * stable for callers that compute in the groomer's zone; the day count itself
 * is a pure difference of two instants, so the zone does not change the whole-day
 * result (both `now` and `deadline` are absolute instants). It is validated and
 * falls back to `'UTC'` for consistency with {@link computeTrialDeadline}.
 *
 * Pure: `(now, deadline, timezone) -> number >= 0`.
 *
 * @param now      The reference instant ("current time").
 * @param deadline The trial deadline (typically from {@link computeTrialDeadline}).
 * @param timezone The groomer's configured IANA timezone.
 * @returns A non-negative integer count of whole days remaining.
 */
export function trialDaysRemaining(now: Date, deadline: Date, timezone: string): number {
  // Validate the zone for signature/behaviour consistency even though the
  // whole-day delta between two absolute instants is zone-independent.
  safeTimezone(timezone);

  const remainingMs = deadline.getTime() - now.getTime();
  if (remainingMs <= 0) return 0;

  return Math.max(0, Math.ceil(remainingMs / MS_PER_DAY));
}
