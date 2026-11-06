/**
 * Once-per-day wrapper for the rebooking-nudge sweep.
 *
 * The reminders cron (`/api/cron/reminders`) may run every ~15 minutes, but
 * the rebook sweep should run once per UTC day. We take a Redis marker
 * `cron:rebook:{YYYY-MM-DD}` with `SET NX EX 90000`; a later call on the same
 * UTC day skips the sweep.
 *
 * Without Redis (or when the SET fails) the sweep runs anyway: the
 * once-per-cycle rule in `shouldNudge` still prevents duplicate nudges.
 * Never throws.
 */
import { getRedis, isRedisConfigured, keys, TTL } from '@/lib/redis';
import { runRebookNudges, type RebookNudgeResult } from '@/lib/rebooking/nudges';

/** Result when the sweep already ran today. */
export interface RebookDailySkipped {
  skipped: 'already_ran_today';
}

/** PURE: the daily marker key for the UTC date of `now`. */
export function rebookDailyKey(now: Date): string {
  return keys.rebookDaily(now.toISOString().slice(0, 10));
}

/**
 * Run {@link runRebookNudges} at most once per UTC day (best-effort).
 */
export async function runRebookNudgesOncePerDay(
  now: Date = new Date()
): Promise<RebookNudgeResult | RebookDailySkipped> {
  if (isRedisConfigured()) {
    try {
      const res = await getRedis().set(rebookDailyKey(now), '1', {
        nx: true,
        ex: TTL.REBOOK_DAILY,
      });
      if (res !== 'OK') return { skipped: 'already_ran_today' };
    } catch (err) {
      console.error('[rebook] daily marker failed, running sweep anyway:', err);
    }
  }

  try {
    return await runRebookNudges(now);
  } catch (err) {
    // runRebookNudges never throws, but keep the contract explicit.
    console.error('[rebook] daily sweep failed:', err);
    return { examined: 0, sent: 0, gatedGroomers: 0 };
  }
}
