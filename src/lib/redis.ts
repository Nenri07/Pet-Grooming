/**
 * Upstash Redis client + typed helper API (PAWPORT Master Spec §4.1, §9.4, §15).
 *
 * Mongo is the source of truth; Redis provides speed and safety:
 *   - tentative booking holds        (hold:{gid}:{holdId}, holds:{gid}:{date})
 *   - race-safe booking locks        (lock:book:{gid})
 *   - availability slot cache        (avail:{gid}:{date})
 *   - Stripe webhook idempotency     (idem:stripe:{eventId})
 *
 * Design notes
 * ------------
 * The client is created lazily on first use. This is important for build/SSR
 * safety: importing this module must never throw, even when the Upstash env
 * vars are absent (e.g. during `next build` on a machine without secrets, or
 * in unit tests). When Redis is not configured, {@link isRedisConfigured}
 * returns `false` and every helper throws a clear "Redis not configured" error
 * the moment it is actually invoked — never at import time.
 *
 * The Upstash HTTP client is serverless-safe (no persistent socket), which is
 * why we use it instead of a TCP Redis client.
 *
 * _Master Spec: §4.1, §9.4, §15_
 */
import { Redis } from '@upstash/redis';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * Whether the Upstash env vars are present. Callers that must degrade
 * gracefully (rate limiting, best-effort cache) should branch on this rather
 * than catch the thrown error.
 */
export function isRedisConfigured(): boolean {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

let _client: Redis | null = null;

/**
 * Lazily-initialised Upstash Redis singleton.
 *
 * @throws Error if the env vars are missing. Guard with {@link isRedisConfigured}
 *         when you need a graceful fallback instead of an exception.
 */
export function getRedis(): Redis {
  if (!isRedisConfigured()) {
    throw new Error(
      'Redis not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN'
    );
  }
  if (!_client) {
    _client = new Redis({ url: REDIS_URL!, token: REDIS_TOKEN! });
  }
  return _client;
}

/**
 * Proxy singleton so callers can `import { redis } from '@/lib/redis'` and use
 * it like the raw client, while initialisation stays lazy and import stays
 * crash-free. Accessing any property before the env is configured throws the
 * clear "Redis not configured" error.
 */
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop, receiver) {
    const client = getRedis();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// ---------------------------------------------------------------------------
// Key builders (§15 REDIS KEY MAP). Centralised so every module uses the exact
// same key shapes and nothing drifts.
// ---------------------------------------------------------------------------

/** TTL constants (seconds) per §15. */
export const TTL = {
  HOLD: 600, // hold:{gid}:{holdId}          EX 600  (10 min)
  HOLD_SET: 86_400, // holds:{gid}:{yyyy-mm-dd}     EX 86400 (1 day)
  LOCK: 10, // lock:book:{gid}              EX 10
  AVAIL: 60, // avail:{gid}:{yyyy-mm-dd}     EX 60
  IDEM: 7 * 24 * 60 * 60, // idem:stripe:{eventId}   EX 7d
  GEOCODE: 30 * 24 * 60 * 60, // geo:{sha1(address)} EX 30d (§10.1)
  TRAVEL: 7 * 24 * 60 * 60, // tt:{hash(a)}:{hash(b)} EX 7d (§10.2)
  ENTITLEMENTS: 60, // ent:{gid}                   EX 60 (§13.2)
  // --- PawPort Phase 7 hook features (§11, §15) ---
  CLAIM: 1800, // claim:{token}               EX 1800 (30 min) (§11.1)
  CLAIM_WON: 1800, // claimwon:{gid}:{startMs}     EX 1800 (§11.1)
  TRACK: 7200, // track:{token}               EX 7200 (2 h) (§11.2)
  // Rebook link token. Not in the §15 map (which predates the token approach);
  // §11.4 uses `/rebook/{token}` — give it a generous 30-day life so a nudge
  // link stays valid across the reminder cycle.
  REBOOK: 30 * 24 * 60 * 60, // rebook:{token}          EX 30d (§11.4)
} as const;

export const keys = {
  hold: (gid: string, holdId: string) => `hold:${gid}:${holdId}`,
  holdSet: (gid: string, dateStr: string) => `holds:${gid}:${dateStr}`,
  lockBook: (gid: string) => `lock:book:${gid}`,
  avail: (gid: string, dateStr: string) => `avail:${gid}:${dateStr}`,
  idemStripe: (eventId: string) => `idem:stripe:${eventId}`,
  // §10.1 geocode cache: keyed by a hash of the normalized address, 30d.
  geocode: (addressHash: string) => `geo:${addressHash}`,
  // §10.2 travel-time matrix cache (Mapbox seam): pair of point hashes, 7d.
  travelTime: (hashA: string, hashB: string) => `tt:${hashA}:${hashB}`,
  // §13.2 resolved entitlements cache, keyed by groomer id, EX 60.
  entitlements: (gid: string) => `ent:${gid}`,
  // §11.1 Fill My Day claim token → {gid,startMs,endMs,clientId}, EX 1800.
  claim: (token: string) => `claim:${token}`,
  // §11.1 first-to-win marker for a filled slot (SET NX), EX 1800.
  claimWon: (gid: string, startMs: number) => `claimwon:${gid}:${startMs}`,
  // §11.2 Live ETA van position token → {lat,lng,ts}, EX 7200.
  track: (token: string) => `track:${token}`,
  // §11.4 rebook link token → {gid,clientId,petId}, EX 30d.
  rebook: (token: string) => `rebook:${token}`,
} as const;

/** The value stored under a `claim:{token}` key (§11.1). */
export interface ClaimRecord {
  gid: string;
  startMs: number;
  endMs: number;
  clientId: string;
}

/** The value stored under a `track:{token}` key (§11.2). */
export interface TrackRecord {
  lat: number;
  lng: number;
  ts: number;
}

/** The value stored under a `rebook:{token}` key (§11.4). */
export interface RebookRecord {
  gid: string;
  clientId: string;
  petId: string;
}

// ---------------------------------------------------------------------------
// Fill My Day claim helpers (§11.1). A claim token is offered to the top
// candidates; the FIRST to confirm wins via `SET claimwon:{gid}:{startMs} NX`.
// ---------------------------------------------------------------------------

/** Store a claim token → slot mapping. `claim:{token}` EX 1800. */
export async function setClaim(token: string, record: ClaimRecord): Promise<void> {
  const r = getRedis();
  await r.set(keys.claim(token), JSON.stringify(record), { ex: TTL.CLAIM });
}

/** Read a claim token's slot mapping, or `null` if missing/expired. */
export async function getClaim(token: string): Promise<ClaimRecord | null> {
  return cacheGet<ClaimRecord>(keys.claim(token));
}

/**
 * Attempt to win a claimed slot, first-to-confirm-wins (§11.1). Uses
 * `SET claimwon:{gid}:{startMs} {clientId} NX EX 1800`.
 *
 * @returns `true` if THIS client won the slot; `false` if someone already did.
 */
export async function tryWinClaim(
  gid: string,
  startMs: number,
  clientId: string
): Promise<boolean> {
  const r = getRedis();
  const res = await r.set(keys.claimWon(gid, startMs), clientId, {
    nx: true,
    ex: TTL.CLAIM_WON,
  });
  return res === 'OK';
}

// ---------------------------------------------------------------------------
// Live ETA tracking helpers (§11.2). The groomer's device posts its position
// every ~20s; the public tracker page reads it every ~10s.
// ---------------------------------------------------------------------------

/** Store the current van position for a tracking token. `track:{token}` EX 7200. */
export async function setTrack(token: string, record: TrackRecord): Promise<void> {
  const r = getRedis();
  await r.set(keys.track(token), JSON.stringify(record), { ex: TTL.TRACK });
}

/** Read the current van position for a tracking token, or `null`. */
export async function getTrack(token: string): Promise<TrackRecord | null> {
  return cacheGet<TrackRecord>(keys.track(token));
}

/** Stop sharing: delete the tracking position key. */
export async function clearTrack(token: string): Promise<void> {
  const r = getRedis();
  await r.del(keys.track(token));
}

// ---------------------------------------------------------------------------
// Rebooking-autopilot link tokens (§11.4). A nudge SMS carries `/rebook/{token}`
// which resolves to a prefilled booking (pet + owner known).
// ---------------------------------------------------------------------------

/** Store a rebook token → {gid,clientId,petId}. `rebook:{token}` EX 30d. */
export async function setRebook(token: string, record: RebookRecord): Promise<void> {
  const r = getRedis();
  await r.set(keys.rebook(token), JSON.stringify(record), { ex: TTL.REBOOK });
}

/** Read a rebook token's mapping, or `null` if missing/expired. */
export async function getRebook(token: string): Promise<RebookRecord | null> {
  return cacheGet<RebookRecord>(keys.rebook(token));
}

/** The value stored under a `hold:{gid}:{holdId}` key. */
export interface HoldRecord {
  startMs: number;
  endMs: number;
  email: string;
}

// ---------------------------------------------------------------------------
// Hold helpers (§9.4). These operate at the raw key level; the higher-level
// hold layer with overlap validation lives in `lib/calendar/holds.ts`.
// ---------------------------------------------------------------------------

/**
 * Persist a hold and register it in the day's hold set.
 * `hold:{gid}:{holdId}` EX 600, and `SADD holds:{gid}:{date}` EX 86400.
 */
export async function setHold(
  gid: string,
  holdId: string,
  dateStr: string,
  record: HoldRecord
): Promise<void> {
  const r = getRedis();
  await r.set(keys.hold(gid, holdId), JSON.stringify(record), { ex: TTL.HOLD });
  await r.sadd(keys.holdSet(gid, dateStr), holdId);
  // Refresh the set TTL so it always outlives its members.
  await r.expire(keys.holdSet(gid, dateStr), TTL.HOLD_SET);
}

/**
 * Read every currently-live hold for a groomer on a given day.
 *
 * Reads the day set with `SMEMBERS`, then `MGET`s each hold key. Members whose
 * hold key has expired/vanished are dropped lazily and cleaned from the set so
 * the set does not grow unbounded.
 */
export async function getActiveHolds(
  gid: string,
  dateStr: string
): Promise<Array<HoldRecord & { holdId: string }>> {
  const r = getRedis();
  const holdIds = await r.smembers(keys.holdSet(gid, dateStr));
  if (!holdIds.length) return [];

  const values = await r.mget<(HoldRecord | string | null)[]>(
    ...holdIds.map((id) => keys.hold(gid, id))
  );

  const active: Array<HoldRecord & { holdId: string }> = [];
  const stale: string[] = [];

  holdIds.forEach((holdId, i) => {
    const raw = values[i];
    if (raw == null) {
      stale.push(holdId);
      return;
    }
    // Upstash may auto-deserialise JSON; handle both object and string.
    const rec: HoldRecord =
      typeof raw === 'string' ? (JSON.parse(raw) as HoldRecord) : (raw as HoldRecord);
    active.push({ holdId, ...rec });
  });

  // Best-effort lazy cleanup of expired members; never blocks the read result.
  if (stale.length) {
    void r.srem(keys.holdSet(gid, dateStr), ...stale).catch(() => {});
  }

  return active;
}

/** Delete a hold key and remove it from the day set. */
export async function deleteHold(
  gid: string,
  holdId: string,
  dateStr: string
): Promise<void> {
  const r = getRedis();
  await r.del(keys.hold(gid, holdId));
  await r.srem(keys.holdSet(gid, dateStr), holdId);
}

// ---------------------------------------------------------------------------
// Distributed lock helpers (§9.4). `SET lock:book:{gid} token NX EX 10`, and a
// token-compare release so we never delete a lock we no longer own.
// ---------------------------------------------------------------------------

/**
 * Attempt to acquire the per-groomer booking lock.
 *
 * @returns `true` if this caller now owns the lock under `token`.
 */
export async function acquireLock(gid: string, token: string): Promise<boolean> {
  const r = getRedis();
  const res = await r.set(keys.lockBook(gid), token, { nx: true, ex: TTL.LOCK });
  return res === 'OK';
}

// Lua: delete the lock only if the stored token matches ours (atomic compare-del).
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/**
 * Release the booking lock only if we still own it (token match). Falls back to
 * a get+del compare if the Lua eval is unavailable.
 *
 * @returns `true` if the lock was owned by us and released.
 */
export async function releaseLock(gid: string, token: string): Promise<boolean> {
  const r = getRedis();
  try {
    const res = await r.eval(RELEASE_LOCK_LUA, [keys.lockBook(gid)], [token]);
    return res === 1;
  } catch {
    // Non-atomic fallback: compare then delete.
    const current = await r.get<string>(keys.lockBook(gid));
    if (current === token) {
      await r.del(keys.lockBook(gid));
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Generic cache helpers (used by the slot cache, §9.3). Typed JSON in/out.
// ---------------------------------------------------------------------------

/** Read a JSON value from the cache, or `null` if missing. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  const raw = await r.get<T | string | null>(key);
  if (raw == null) return null;
  return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T);
}

/** Write a JSON value to the cache with a TTL in seconds. */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const r = getRedis();
  await r.set(key, JSON.stringify(value), { ex: ttlSeconds });
}

/** Delete one or more cache keys. */
export async function cacheDel(...keysToDelete: string[]): Promise<void> {
  if (!keysToDelete.length) return;
  const r = getRedis();
  await r.del(...keysToDelete);
}

// ---------------------------------------------------------------------------
// Idempotency (§9.4). Store `idem:stripe:{eventId}` EX 7d; the first caller for
// a given event id gets `true`, duplicates get `false`.
// ---------------------------------------------------------------------------

/**
 * Claim a Stripe event id exactly once.
 *
 * @returns `true` if this is the first time we've seen `eventId` (proceed),
 *          `false` if it was already processed (skip as a duplicate).
 */
export async function idempotencyOnce(eventId: string): Promise<boolean> {
  const r = getRedis();
  const res = await r.set(keys.idemStripe(eventId), '1', { nx: true, ex: TTL.IDEM });
  return res === 'OK';
}
