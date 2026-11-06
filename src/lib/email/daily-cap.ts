/**
 * Platform-wide daily email cap guard (Resend free plan: 100 emails/day).
 *
 * Every email Resend accepts is counted in Redis under `email:day:{YYYY-MM-DD}`
 * (UTC). The count drives three states:
 *   - 'ok'      below 80% of the limit
 *   - 'warn'    80% or more: log, and send the founder ONE alert email per day
 *   - 'reserve' 90% or more: optional messages (Fill My Day offers, rebooking
 *               nudges, optional Inbox emails) pause so confirmations and
 *               reminders keep the remaining quota
 *
 * `EMAIL_DAILY_LIMIT` sets the limit (default 100); `0` disables the guard.
 * Everything here is best-effort: it never throws and never blocks a send.
 */
import { getRedis, isRedisConfigured, keys, TTL } from '@/lib/redis';

export type EmailCapState = 'ok' | 'warn' | 'reserve';

export const DEFAULT_EMAIL_DAILY_LIMIT = 100;

/** The daily email limit from `EMAIL_DAILY_LIMIT` (default 100; 0 disables the guard). */
export function emailDailyLimit(raw: string | undefined = process.env.EMAIL_DAILY_LIMIT): number {
  const v = (raw ?? '').trim();
  if (!v) return DEFAULT_EMAIL_DAILY_LIMIT;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_EMAIL_DAILY_LIMIT;
  return Math.floor(n);
}

/**
 * PURE: the cap state for `sent` emails against a daily `limit`.
 * 'warn' at >= 80% of the limit, 'reserve' at >= 90%. A limit of 0 (or any
 * non-positive / non-finite value) disables the guard and is always 'ok'.
 */
export function emailCapState(sent: number, limit: number): EmailCapState {
  if (!Number.isFinite(limit) || limit <= 0) return 'ok';
  if (!Number.isFinite(sent) || sent <= 0) return 'ok';
  // Integer-safe comparisons: sent / limit >= 0.9  <=>  10 * sent >= 9 * limit.
  if (sent * 10 >= limit * 9) return 'reserve';
  if (sent * 10 >= limit * 8) return 'warn';
  return 'ok';
}

/** PURE: the UTC date string (YYYY-MM-DD) for `now`. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Emails counted today (UTC). 0 when Redis is not configured or fails. */
export async function getEmailsSentToday(now: Date = new Date()): Promise<number> {
  try {
    if (!isRedisConfigured()) return 0;
    const raw = await getRedis().get<number | string | null>(keys.emailDay(utcDay(now)));
    const n = Number(raw ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (err) {
    console.error('[email] daily cap: could not read today\u2019s count (non-fatal):', err);
    return 0;
  }
}

/** Today's count, the limit and the resulting state (for the cron response). */
export async function getEmailCapStatus(
  now: Date = new Date()
): Promise<{ emailsToday: number; limit: number; state: EmailCapState }> {
  const limit = emailDailyLimit();
  const emailsToday = await getEmailsSentToday(now);
  return { emailsToday, limit, state: emailCapState(emailsToday, limit) };
}

/** True while the platform is in 'reserve' (optional messages should pause). */
export async function isEmailReserveActive(now: Date = new Date()): Promise<boolean> {
  const limit = emailDailyLimit();
  if (limit <= 0) return false;
  return emailCapState(await getEmailsSentToday(now), limit) === 'reserve';
}

/** Sends the founder's daily-cap alert. Injected by `send.ts` to avoid an import cycle. */
export type CapAlertSender = (sent: number, limit: number) => Promise<boolean>;

/**
 * Count one email Resend accepted. When the count reaches 'warn' or 'reserve',
 * log a `[email] daily cap` line and, if `sendAlert` is given, send the
 * founder ONE alert per UTC day (guarded by a Redis `SET NX` marker).
 *
 * Pass no `sendAlert` when counting the alert email itself, so it cannot
 * trigger another alert. Never throws.
 */
export async function recordEmailSent(
  sendAlert?: CapAlertSender,
  now: Date = new Date()
): Promise<number | null> {
  try {
    if (!isRedisConfigured()) return null;
    const r = getRedis();
    const day = utcDay(now);
    const key = keys.emailDay(day);
    const sent = Number(await r.incr(key));
    if (sent === 1) await r.expire(key, TTL.EMAIL_DAY);

    const limit = emailDailyLimit();
    const state = emailCapState(sent, limit);
    if (state === 'ok') return sent;

    console.warn(
      `[email] daily cap: ${state} (${sent} of ${limit} emails sent today)` +
        (state === 'reserve' ? '; optional messages are paused until tomorrow (UTC).' : '')
    );

    if (sendAlert) {
      const marked = await r.set(keys.emailDayAlert(day), String(sent), { nx: true, ex: TTL.EMAIL_DAY });
      if (marked === 'OK') {
        const ok = await sendAlert(sent, limit);
        if (!ok) console.error('[email] daily cap: founder alert email was not sent.');
      }
    }
    return sent;
  } catch (err) {
    console.error('[email] daily cap: counting failed (non-fatal):', err);
    return null;
  }
}

/** True when a Resend error means the account's sending quota is used up. */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; statusCode?: unknown };
  return e.name === 'daily_quota_exceeded' || e.name === 'monthly_quota_exceeded';
}

/** True when a Resend error is an HTTP 429 (quota or rate limit). */
export function isTooManyRequests(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { statusCode?: unknown }).statusCode === 429 || isQuotaError(err);
}
