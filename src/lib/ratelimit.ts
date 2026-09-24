/**
 * Rate limiting helpers built on `@upstash/ratelimit` (Master Spec §9.4, §15).
 *
 * Limits are keyed by `rl:{route}:{ip}` using a sliding window:
 *   - hold endpoint:    10 requests / minute / IP
 *   - booking endpoints: 30 requests / minute / IP
 *
 * Graceful degradation: if Redis is not configured (missing Upstash env vars),
 * the limiters are not constructed and {@link checkRateLimit} allows every
 * request. This keeps build/SSR and local/test environments working without
 * secrets, matching the safe-fallback approach in `lib/redis.ts`.
 *
 * _Master Spec: §9.4, §15_
 */
import { Ratelimit } from '@upstash/ratelimit';
import { getRedis, isRedisConfigured } from '@/lib/redis';

/** Prefix for all rate-limit keys (§15: `rl:{route}:{ip}`). */
const RL_PREFIX = 'rl';

/** Result of a rate-limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed to proceed. */
  success: boolean;
  /** Remaining requests in the current window (best-effort). */
  remaining: number;
}

/**
 * Build a sliding-window limiter, or `null` when Redis is unconfigured.
 * `prefix` is folded into the Upstash key so the final key is
 * `rl:{route}:{ip}` when callers pass `route:ip` as the identifier.
 */
function makeLimiter(tokens: number): Ratelimit | null {
  if (!isRedisConfigured()) return null;
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(tokens, '60 s'),
    prefix: RL_PREFIX,
    analytics: false,
  });
}

let _holdLimiter: Ratelimit | null | undefined;
let _bookingLimiter: Ratelimit | null | undefined;

/** Hold endpoint limiter: 10 requests / minute / IP. */
export function holdRateLimit(): Ratelimit | null {
  if (_holdLimiter === undefined) _holdLimiter = makeLimiter(10);
  return _holdLimiter;
}

/** Booking endpoints limiter: 30 requests / minute / IP. */
export function bookingRateLimit(): Ratelimit | null {
  if (_bookingLimiter === undefined) _bookingLimiter = makeLimiter(30);
  return _bookingLimiter;
}

/**
 * Check a limiter for a given key (typically `"{route}:{ip}"`).
 *
 * Degrades gracefully: a `null` limiter (Redis unconfigured) always allows.
 * A transient Redis error also fails open so a rate-limit outage never blocks
 * legitimate bookings.
 *
 * @param limiter The limiter from {@link holdRateLimit}/{@link bookingRateLimit}.
 * @param key     Identifier, e.g. `"book:hold:203.0.113.7"`.
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  key: string
): Promise<RateLimitResult> {
  if (!limiter) return { success: true, remaining: Infinity };
  try {
    const { success, remaining } = await limiter.limit(key);
    return { success, remaining };
  } catch {
    // Fail open — never let a rate-limiter outage break the booking flow.
    return { success: true, remaining: Infinity };
  }
}
