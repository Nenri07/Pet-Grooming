/**
 * Monthly SMS quota (Master Spec §12.3, §15) — pure decision + Redis counter.
 *
 * The DECISION ({@link canSend}, {@link isTransactional}) is PURE and fully
 * unit-testable: no Redis, no DB, no env. The COUNTER side ({@link incrementUsage},
 * {@link getUsage}) uses `INCR sms:usage:{gid}:{yyyymm}` with a ~40-day TTL and
 * degrades to a no-op when Redis is unconfigured, so nothing here can crash a
 * send in a credential-free environment.
 *
 * Quota policy (§12.3): a monthly allowance per plan. As usage approaches the
 * cap we shed load by importance:
 *   - Reserve a small per-groomer buffer below the included allowance.
 *   - At/over 100% of the (buffered) allowance, block NON-transactional
 *     (marketing) messages first — rebook nudges, review requests, fill offers.
 *   - Over a hard ceiling, block everything EXCEPT booking confirmations, which
 *     are the most important transactional message and always go out.
 *
 * _Master Spec: §12.3, §15_
 */
import type { SmsKind } from './provider';

/**
 * Transactional kinds (confirmations, reminders, receipts, and operational
 * status like on-my-way / late / rescheduled / cancelled, plus groomer
 * replies). Marketing kinds are rebook nudges, review requests, and Fill My Day
 * offers (Master Spec §12.3). Pure.
 */
const MARKETING_KINDS: ReadonlySet<SmsKind> = new Set<SmsKind>([
  'rebook_nudge',
  'review_request',
  'fill_my_day_offer',
]);

/**
 * Whether `kind` is transactional (as opposed to marketing). Confirmations,
 * reminders and receipts are transactional; rebook/review/fill offers are
 * marketing. Pure.
 */
export function isTransactional(kind: SmsKind): boolean {
  return !MARKETING_KINDS.has(kind);
}

/** The small per-groomer buffer reserved below the included allowance (§12.3). */
export const QUOTA_BUFFER = 10;

/** Inputs to the pure quota decision. */
export interface CanSendInput {
  /** Messages already sent this month (the current counter value). */
  used: number;
  /** Included monthly allowance for this groomer's plan. */
  included: number;
  /** The kind being considered. */
  kind: SmsKind;
  /** Optional override for the reserved buffer (defaults to {@link QUOTA_BUFFER}). */
  buffer?: number;
}

/** Reason a send was blocked (or `null` when allowed). */
export type QuotaBlockReason = 'quota_marketing' | 'quota_exhausted' | null;

/** Result of the pure quota decision. */
export interface CanSendResult {
  allowed: boolean;
  reason: QuotaBlockReason;
}

/**
 * PURE quota decision (Master Spec §12.3).
 *
 * Thresholds (with `buffer` reserved below `included`):
 *   - `soft = max(0, included - buffer)` — at/over this, marketing is blocked.
 *   - `hard = included` — at/over this, everything except `booking_confirmed`
 *     is blocked.
 *
 * So the shedding order as usage climbs is: marketing first (at `soft`), then
 * all non-confirmation traffic (at `hard`), while booking confirmations are
 * never blocked by quota.
 *
 * Edge handling: a non-positive `included` (e.g. misconfigured plan) still lets
 * booking confirmations through and blocks the rest.
 */
export function canSend(input: CanSendInput): CanSendResult {
  const buffer = input.buffer ?? QUOTA_BUFFER;
  const included = Number.isFinite(input.included) ? input.included : 0;
  const used = Number.isFinite(input.used) ? input.used : 0;

  const soft = Math.max(0, included - buffer);
  const hard = Math.max(0, included);

  // Booking confirmations are the highest priority: never quota-blocked.
  if (input.kind === 'booking_confirmed') {
    return { allowed: true, reason: null };
  }

  // Hard ceiling: block everything except booking confirmations (handled above).
  if (used >= hard) {
    return { allowed: false, reason: 'quota_exhausted' };
  }

  // Soft ceiling: block marketing first, keep transactional flowing.
  if (used >= soft && !isTransactional(input.kind)) {
    return { allowed: false, reason: 'quota_marketing' };
  }

  return { allowed: true, reason: null };
}

// ---------------------------------------------------------------------------
// Redis counter side (§15). Degrades to a no-op when Redis is unconfigured.
// ---------------------------------------------------------------------------

/** ~40 days in seconds (Master Spec §15: `sms:usage:{gid}:{yyyymm}` EX ~40d). */
export const USAGE_TTL_SECONDS = 40 * 24 * 60 * 60;

/** Current month key component `yyyymm` in UTC. */
export function monthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/** The Redis usage key for a groomer + month (Master Spec §15). */
export function usageKey(groomerId: string, now: Date = new Date()): string {
  return `sms:usage:${groomerId}:${monthKey(now)}`;
}

/**
 * Read the current month's usage for a groomer. Returns 0 when Redis is
 * unconfigured or on any error (fail-open so a Redis hiccup never blocks a
 * transactional send).
 */
export async function getUsage(groomerId: string, now: Date = new Date()): Promise<number> {
  const { isRedisConfigured, getRedis } = await import('@/lib/redis');
  if (!isRedisConfigured()) return 0;
  try {
    const raw = await getRedis().get<number | string | null>(usageKey(groomerId, now));
    if (raw == null) return 0;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error('[sms:quota] getUsage failed, treating as 0:', err);
    return 0;
  }
}

/**
 * `INCR sms:usage:{gid}:{yyyymm}` and (re)apply the ~40d TTL. Returns the new
 * count, or the previous best-effort value / 0 when Redis is unconfigured.
 * Never throws.
 */
export async function incrementUsage(
  groomerId: string,
  now: Date = new Date()
): Promise<number> {
  const { isRedisConfigured, getRedis } = await import('@/lib/redis');
  if (!isRedisConfigured()) return 0;
  try {
    const r = getRedis();
    const key = usageKey(groomerId, now);
    const next = await r.incr(key);
    // Refresh TTL each time so the counter always expires ~40d after last use.
    await r.expire(key, USAGE_TTL_SECONDS).catch(() => {});
    return next;
  } catch (err) {
    console.error('[sms:quota] incrementUsage failed:', err);
    return 0;
  }
}
