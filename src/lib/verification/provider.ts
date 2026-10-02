/**
 * Phone-verification provider seam + factory (Billing, Trial, and Payments —
 * Requirements 10.2, 10.3, 10.4, 13.1, 13.2, 13.4, 19.1).
 *
 * This is the OTP seam of the trial-abuse-prevention pipeline (gate 4). It
 * mirrors the existing `SmsProvider`/`BillingProvider` conventions EXACTLY:
 *   - an `interface` describing the behaviour,
 *   - an `is…Configured()` placeholder-aware gate,
 *   - a `get…Provider()` factory that picks a concrete impl by config and
 *     caches it, plus a `reset…Provider()` for tests,
 *   - a `Noop…Provider` fallback so callers never branch on configuration,
 *   - lazy SDK loading (the Twilio SDK is NEVER imported at module scope).
 *
 * Import safety: importing this module must NEVER throw, even with zero
 * credentials — the Twilio SDK is loaded lazily inside {@link TwilioVerifyProvider}
 * only once {@link isTwilioVerifyConfigured} is true. Every method returns a
 * typed envelope ({@link VerifyStartResult}/{@link VerifyCheckResult}); nothing
 * here throws for an expected failure (unconfigured, provider down, wrong code,
 * expired, rate-limited). All user-facing `message`s are safe to show directly
 * and never leak provider internals or secrets (R13.4, R19.1).
 *
 * Provider selection (design "VerificationProvider seam"):
 *   1. `TWILIO_VERIFY_SERVICE_SID` set        → {@link TwilioVerifyProvider}
 *      (hosted OTP: Twilio manages code storage, expiry and rate limits).
 *   2. else SMS configured AND Redis configured → {@link OtpSmsProvider}
 *      (generate a code locally, store it hashed in Redis, deliver via the
 *      existing {@link SmsProvider}).
 *   3. else                                   → {@link NoopVerificationProvider}
 *      (returns `not_configured` envelopes; the phone step renders a labelled
 *      Not_Configured_State and never permanently blocks — R13.1).
 *
 * _Requirements: 10.2, 10.3, 10.4, 13.1, 13.2, 13.4, 19.1_
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { getPhonePepper, isTwilioVerifyConfigured } from '@/lib/identity/config';
import {
  OtpRecord,
  TTL,
  cacheGet,
  cacheSet,
  getRedis,
  isRedisConfigured,
  keys,
} from '@/lib/redis';
import { getSmsProvider, isSmsConfigured, type SmsProvider } from '@/lib/sms/provider';

// ---------------------------------------------------------------------------
// Types — the typed envelopes every method returns (design seam block).
// ---------------------------------------------------------------------------

/** Why a verification start/check did not succeed. All are expected, non-throwing outcomes. */
export type VerifyFailureReason =
  | 'not_configured'
  | 'provider_unavailable'
  | 'invalid_code'
  | 'expired'
  | 'rate_limited';

/** Result of {@link VerificationProvider.startPhoneVerification}. */
export type VerifyStartResult =
  | { ok: true; channel: 'sms'; expiresInSec: number }
  | { ok: false; reason: VerifyFailureReason; message: string };

/** Result of {@link VerificationProvider.checkPhoneVerification}. */
export type VerifyCheckResult =
  | { ok: true; verified: true }
  | { ok: false; reason: VerifyFailureReason; message: string };

/**
 * The phone-OTP seam. `TwilioVerifyProvider` and `OtpSmsProvider` implement it
 * against real backends; `NoopVerificationProvider` is the log-only fallback.
 *
 * _Requirements: 10.2, 10.3_
 */
export interface VerificationProvider {
  /** Send an OTP to a normalized E.164 phone (Req 10.2). */
  startPhoneVerification(params: { phoneE164: string }): Promise<VerifyStartResult>;
  /** Check a submitted code against the active challenge (Req 10.3/10.4). */
  checkPhoneVerification(params: { phoneE164: string; code: string }): Promise<VerifyCheckResult>;
}

// ---------------------------------------------------------------------------
// User-safe messages (R13.4, R19.1). No provider names, SIDs, or secrets.
// ---------------------------------------------------------------------------

const MSG_NOT_CONFIGURED = "Phone verification isn't set up yet.";
const MSG_PROVIDER_DOWN = "We couldn't send your code right now. Please try again in a moment.";
const MSG_INVALID_CODE = 'That code is incorrect. Please check it and try again.';
const MSG_EXPIRED = 'That code has expired. Please request a new one.';
const MSG_RATE_LIMITED = 'Please wait a moment before requesting another code.';

/** OTP length (digits) + max wrong attempts before the challenge is burned. */
const OTP_LENGTH = 6;
const MAX_OTP_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Shared helpers — code hashing + phone-identity hashing.
// ---------------------------------------------------------------------------

/** Hash an OTP code with SHA-256 (hex). Codes are never stored in the clear. */
function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/**
 * Derive the Redis key component for a phone identity, reusing the SAME hashing
 * approach the `IdentityBinding` ledger uses: `sha256(E.164 + pepper)` (R11,
 * R19.1). The raw E.164 is NEVER used as a key.
 *
 * Degrade (per {@link getPhonePepper}): when the pepper is `null` (unset /
 * placeholder) we still hash — with the E.164 alone — so OTP storage keeps
 * working. This is weaker (an attacker who knows the number can compute the
 * key) but functional; the pepper only hardens the key against offline
 * correlation. The weaker-but-functional degrade is intentional and logged by
 * the config accessor's contract.
 */
function phoneHash(phoneE164: string): string {
  const pepper = getPhonePepper();
  const material = pepper ? `${phoneE164}${pepper}` : phoneE164;
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/** Constant-time compare of two hex digests of equal length. */
function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/** Generate a zero-padded numeric OTP of {@link OTP_LENGTH} digits. */
function generateOtp(): string {
  const max = 10 ** OTP_LENGTH; // exclusive upper bound
  return String(randomInt(0, max)).padStart(OTP_LENGTH, '0');
}

// ---------------------------------------------------------------------------
// Minimal Twilio Verify client typings (we type only the bits we use, like
// `twilio.ts` does, so the SDK's full types never enter scope).
// ---------------------------------------------------------------------------

interface TwilioVerificationInstance {
  status: string;
}
interface TwilioVerifyService {
  verifications: {
    create(opts: { to: string; channel: string }): Promise<TwilioVerificationInstance>;
  };
  verificationChecks: {
    create(opts: { to: string; code: string }): Promise<TwilioVerificationInstance>;
  };
}
interface TwilioVerifyClient {
  verify: {
    v2: {
      services(serviceSid: string): TwilioVerifyService;
    };
  };
}

/**
 * Preferred OTP provider backed by **Twilio Verify** (R10.2/10.3). Twilio
 * manages code generation, storage, expiry and rate limits, so no local Redis
 * state is needed on this path.
 *
 * The Twilio SDK is imported LAZILY on first use (async import inside
 * {@link getClient}), exactly like {@link TwilioProvider}, so this class never
 * pulls the SDK into the module graph at import time.
 */
export class TwilioVerifyProvider implements VerificationProvider {
  private client: TwilioVerifyClient | null = null;
  private readonly serviceSid: string;

  constructor() {
    // Read here: the constructor only runs when configured (via the factory).
    this.serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID ?? '';
  }

  /** Lazily construct the Twilio client on first use (dynamic import). */
  private async getClient(): Promise<TwilioVerifyClient> {
    if (this.client) return this.client;

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token || !this.serviceSid) {
      throw new Error(
        'Twilio Verify not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID'
      );
    }

    const mod = (await import('twilio')) as unknown as {
      default: (accountSid: string, authToken: string) => TwilioVerifyClient;
    };
    this.client = mod.default(sid, token);
    return this.client;
  }

  async startPhoneVerification({
    phoneE164,
  }: {
    phoneE164: string;
  }): Promise<VerifyStartResult> {
    try {
      const client = await this.getClient();
      await client.verify.v2
        .services(this.serviceSid)
        .verifications.create({ to: phoneE164, channel: 'sms' });
      // Twilio owns the real expiry (default 10 min); surface a sensible hint.
      return { ok: true, channel: 'sms', expiresInSec: TTL.OTP };
    } catch (err) {
      console.error('[verification] Twilio Verify start failed:', err);
      return { ok: false, reason: 'provider_unavailable', message: MSG_PROVIDER_DOWN };
    }
  }

  async checkPhoneVerification({
    phoneE164,
    code,
  }: {
    phoneE164: string;
    code: string;
  }): Promise<VerifyCheckResult> {
    try {
      const client = await this.getClient();
      const check = await client.verify.v2
        .services(this.serviceSid)
        .verificationChecks.create({ to: phoneE164, code });
      if (check.status === 'approved') {
        return { ok: true, verified: true };
      }
      // Any non-approved status (pending/canceled/expired) reads as a bad code.
      return { ok: false, reason: 'invalid_code', message: MSG_INVALID_CODE };
    } catch (err) {
      console.error('[verification] Twilio Verify check failed:', err);
      return { ok: false, reason: 'provider_unavailable', message: MSG_PROVIDER_DOWN };
    }
  }
}

/**
 * Fallback OTP provider that works with ONLY the existing SMS vendor plus Redis
 * — no Twilio Verify service SID required (R10.4).
 *
 * Flow:
 *   - start: enforce a resend rate-limit (`otp:rl:{phoneHash}` SET NX EX
 *     {@link TTL.OTP_RATE}); generate a 6-digit code; store `{codeHash,attempts:0}`
 *     under `otp:{phoneHash}` with {@link TTL.OTP}; deliver via the existing
 *     {@link SmsProvider}. The raw code is never persisted.
 *   - check: load the record (missing/expired ⇒ `expired`); compare
 *     `sha256(code)` to the stored hash in constant time. On match, delete the
 *     key and return verified. On mismatch, increment `attempts`; once the cap
 *     ({@link MAX_OTP_ATTEMPTS}) is reached the challenge is burned (deleted)
 *     and treated as expired so the caller must request a fresh code.
 *
 * All failures return envelopes; nothing throws for expected conditions.
 */
export class OtpSmsProvider implements VerificationProvider {
  constructor(private readonly sms: SmsProvider = getSmsProvider()) {}

  async startPhoneVerification({
    phoneE164,
  }: {
    phoneE164: string;
  }): Promise<VerifyStartResult> {
    const hash = phoneHash(phoneE164);
    try {
      const redis = getRedis();

      // Resend throttle: first caller in the window wins the NX marker.
      const marker = await redis.set(keys.otpRate(hash), '1', {
        nx: true,
        ex: TTL.OTP_RATE,
      });
      if (marker !== 'OK') {
        return { ok: false, reason: 'rate_limited', message: MSG_RATE_LIMITED };
      }

      const code = generateOtp();
      const record: OtpRecord = { codeHash: hashCode(code), attempts: 0 };
      await cacheSet(keys.otp(hash), record, TTL.OTP);

      // Deliver through the existing transactional SMS seam. `groomerId` is not
      // known at OTP time (the registrant has no groomer id yet), so we pass a
      // neutral marker; the SMS kind is the transactional `reply`.
      await this.sms.send({
        to: phoneE164,
        body: `Your verification code is ${code}. It expires in ${Math.round(
          TTL.OTP / 60
        )} minutes.`,
        groomerId: 'verification',
        kind: 'reply',
      });

      return { ok: true, channel: 'sms', expiresInSec: TTL.OTP };
    } catch (err) {
      console.error('[verification] OTP start failed:', err);
      return { ok: false, reason: 'provider_unavailable', message: MSG_PROVIDER_DOWN };
    }
  }

  async checkPhoneVerification({
    phoneE164,
    code,
  }: {
    phoneE164: string;
    code: string;
  }): Promise<VerifyCheckResult> {
    const hash = phoneHash(phoneE164);
    const key = keys.otp(hash);
    try {
      const record = await cacheGet<OtpRecord>(key);
      if (!record) {
        // Missing or TTL-expired challenge.
        return { ok: false, reason: 'expired', message: MSG_EXPIRED };
      }

      if (hashesEqual(hashCode(code), record.codeHash)) {
        // Success: burn the one-time challenge so it can't be replayed.
        await getRedis().del(key);
        return { ok: true, verified: true };
      }

      // Wrong code: count the attempt and burn the challenge once the cap hits.
      const attempts = record.attempts + 1;
      if (attempts >= MAX_OTP_ATTEMPTS) {
        await getRedis().del(key);
        return { ok: false, reason: 'expired', message: MSG_EXPIRED };
      }
      // Preserve the remaining TTL rather than resetting the window.
      let ttl = await getRedis().ttl(key);
      if (ttl <= 0) ttl = TTL.OTP;
      await cacheSet<OtpRecord>(key, { codeHash: record.codeHash, attempts }, ttl);
      return { ok: false, reason: 'invalid_code', message: MSG_INVALID_CODE };
    } catch (err) {
      console.error('[verification] OTP check failed:', err);
      return { ok: false, reason: 'provider_unavailable', message: MSG_PROVIDER_DOWN };
    }
  }
}

/**
 * Log-only verification provider used when nothing is configured. Every method
 * returns a `not_configured` envelope so the phone step renders a labelled
 * Not_Configured_State and the registrant is never permanently blocked (R13.1).
 */
export class NoopVerificationProvider implements VerificationProvider {
  async startPhoneVerification(): Promise<VerifyStartResult> {
    return { ok: false, reason: 'not_configured', message: MSG_NOT_CONFIGURED };
  }

  async checkPhoneVerification(): Promise<VerifyCheckResult> {
    return { ok: false, reason: 'not_configured', message: MSG_NOT_CONFIGURED };
  }
}

/**
 * Whether phone verification is configured in some working form (R13.1, R19.4).
 *
 * `true` when EITHER:
 *   - Twilio Verify is configured ({@link isTwilioVerifyConfigured}) — the
 *     hosted path needs no local storage; OR
 *   - the SMS vendor is configured ({@link isSmsConfigured}) AND Redis is
 *     configured ({@link isRedisConfigured}) — the fallback path needs BOTH:
 *     SMS to deliver the code and Redis to store the one-time challenge.
 *
 * All underlying accessors are placeholder-aware, so shipped placeholder values
 * read as "not configured" and this returns `false` (⇒ `NoopVerificationProvider`).
 */
export function isVerificationConfigured(): boolean {
  if (isTwilioVerifyConfigured()) return true;
  return isSmsConfigured() && isRedisConfigured();
}

// Cached instance so we don't rebuild a client/provider on every call.
let _cachedProvider: VerificationProvider | undefined;

/**
 * Return the active verification provider.
 *
 * - `TWILIO_VERIFY_SERVICE_SID` set        → {@link TwilioVerifyProvider}.
 * - else SMS + Redis configured            → {@link OtpSmsProvider}.
 * - else                                   → {@link NoopVerificationProvider}.
 *
 * Never throws. The instance is cached; call {@link resetVerificationProvider}
 * in tests that toggle env between cases.
 */
export function getVerificationProvider(): VerificationProvider {
  if (_cachedProvider) return _cachedProvider;

  if (isTwilioVerifyConfigured()) {
    try {
      _cachedProvider = new TwilioVerifyProvider();
      return _cachedProvider;
    } catch (err) {
      console.error(
        '[verification] Failed to initialise Twilio Verify provider, falling back:',
        err
      );
      // Fall through to the next best option below.
    }
  }

  if (isSmsConfigured() && isRedisConfigured()) {
    try {
      _cachedProvider = new OtpSmsProvider();
      return _cachedProvider;
    } catch (err) {
      console.error('[verification] Failed to initialise OTP-over-SMS provider, falling back:', err);
      _cachedProvider = new NoopVerificationProvider();
      return _cachedProvider;
    }
  }

  _cachedProvider = new NoopVerificationProvider();
  return _cachedProvider;
}

/** Clear the cached provider (used by tests that toggle env between cases). */
export function resetVerificationProvider(): void {
  _cachedProvider = undefined;
}
