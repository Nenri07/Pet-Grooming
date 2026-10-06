'use server';

/**
 * Verification server actions — phone OTP + email verification
 * (Billing, Trial, and Payments; Phase 2 abuse-prevention pipeline, gate 3/4).
 *
 * Four actions, all following the project's server-action conventions
 * (`src/actions/auth.ts`, `src/actions/billing.ts`):
 *   - they NEVER throw: every I/O path is wrapped and collapses to a typed
 *     `{ ok }` envelope,
 *   - every user-facing `message` is safe to render directly and never leaks a
 *     provider name, SID, token, or any other internal detail (R13.4, R19.1),
 *   - the phone actions and the email actions are scoped to the authenticated
 *     groomer (`session.user.id`); an unauthenticated caller gets a
 *     `not_signed_in` envelope rather than an exception.
 *
 * The two phone actions delegate to the {@link getVerificationProvider} seam
 * (Twilio Verify → OTP-over-SMS → Noop), mapping its {@link VerifyStartResult}/
 * {@link VerifyCheckResult} onto these action envelopes. They deliberately do
 * NOT persist the phone — recording the verified phone + identity binding is
 * the trial-provisioning pipeline's job (task 9.2); `confirmPhoneOtp` only
 * hands back the canonical E.164 for that pipeline to bind.
 *
 * The two email actions use a Redis-stored one-time token
 * (`keys.emailVerify(token)` → {@link EmailVerifyRecord}) plus the existing
 * Resend seam ({@link sendEmailVerification}); confirming sets
 * `User.emailVerifiedAt`.
 *
 * _Requirements: 7.1 (email verification token + link), 7.3/7.4 (record
 * verified email on the User), 10.1 (phone-verification entry), 10.2 (send
 * OTP), 10.3 (check OTP), 10.4 (OTP rate-limit / attempts), 13.2 (provider
 * seam delegation), 13.3 (degrade when a provider is down), 13.4 (user-safe
 * messages — no provider internals)._
 * _Design: New server actions (`src/actions/verification.ts`)._
 */
import { randomBytes } from 'node:crypto';

import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';
import { sendEmailVerification } from '@/lib/email/send';
import { getEmailVerificationTtlMin } from '@/lib/identity/config';
import { normalizeEmail } from '@/lib/identity/email';
import { normalizePhoneE164 } from '@/lib/identity/phone';
import {
  TTL,
  cacheDel,
  cacheGet,
  cacheSet,
  getRedis,
  isRedisConfigured,
  keys,
  type EmailVerifyRecord,
} from '@/lib/redis';
import { getVerificationProvider, type VerifyFailureReason } from '@/lib/verification/provider';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Default region (ISO 3166-1 alpha-2) used to resolve national-format phone
 * input into canonical E.164 (R10.5). Read from `DEFAULT_PHONE_REGION`, falling
 * back to `'US'` when unset. The pure normalizer only accepts a small set of
 * regions; an unknown region simply makes national-format input unresolvable
 * (→ invalid-phone envelope), which is the correct safe outcome.
 */
function getDefaultPhoneRegion(): string {
  const raw = process.env.DEFAULT_PHONE_REGION?.trim();
  return raw && raw.length > 0 ? raw.toUpperCase() : 'US';
}

/** Absolute app base URL for building the verification link. */
function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
  return `${base}${path}`;
}

// ---------------------------------------------------------------------------
// User-safe messages. No provider names, SIDs, tokens, or secrets (R13.4).
// ---------------------------------------------------------------------------

const MSG_NOT_SIGNED_IN = 'You must be signed in to verify your identity.';
const MSG_INVALID_PHONE =
  "That phone number doesn't look right. Please check it and try again.";
const MSG_INVALID_CODE = 'That code is incorrect. Please check it and try again.';
const MSG_UNEXPECTED =
  'Something went wrong. Please try again in a moment.';
const MSG_EMAIL_NOT_CONFIGURED =
  "Email verification isn't available right now. Please try again later.";
const MSG_EMAIL_SENT =
  'Check your inbox for a link to verify your email address.';
const MSG_EMAIL_SENT_DEV =
  'Your verification link has been created. Email delivery is not set up yet, so it may not arrive in this environment.';
const MSG_EMAIL_LINK_INVALID =
  'That verification link is invalid or has expired. Please request a new one.';
const MSG_EMAIL_VERIFIED = 'Your email address has been verified.';
const MSG_NO_EMAIL = 'We could not find an email address for your account.';
const MSG_RESEND_COOLDOWN =
  'Please wait a moment before requesting another link.';

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

/**
 * Why a verification action did not succeed. `not_signed_in` and `invalid_phone`
 * are action-local; the rest mirror {@link VerifyFailureReason} so the UI can
 * branch uniformly. `unexpected` covers any wrapped I/O failure.
 */
export type VerificationFailureReason =
  | 'not_signed_in'
  | 'invalid_phone'
  | VerifyFailureReason
  | 'unexpected';

/** Result of {@link requestPhoneOtp}. */
export type RequestPhoneOtpResult =
  | { ok: true; channel: 'sms'; expiresInSec: number }
  | { ok: false; reason: VerificationFailureReason; message: string };

/** Result of {@link confirmPhoneOtp}. On success it carries the canonical E.164. */
export type ConfirmPhoneOtpResult =
  | { ok: true; phoneE164: string }
  | { ok: false; reason: VerificationFailureReason; message: string };

/** Result of {@link requestEmailVerification}. */
export type RequestEmailVerificationResult =
  | { ok: true; message: string; delivered: boolean }
  | { ok: false; reason: VerificationFailureReason; message: string };

/** Result of {@link confirmEmailVerification}. */
export type ConfirmEmailVerificationResult =
  | { ok: true; message: string }
  | { ok: false; reason: VerificationFailureReason; message: string };

/**
 * Result of {@link resendEmailVerification}. On success it mirrors
 * {@link RequestEmailVerificationResult}'s `delivered` + `message`; the
 * `cooldown` failure additionally carries `retryAfterSec` (remaining seconds in
 * the Redis-backed resend window), and every other failure mirrors
 * {@link requestEmailVerification}'s `reason` + `message`.
 */
export type ResendCooldownResult =
  | { ok: true; delivered: boolean; message: string }
  | { ok: false; reason: 'cooldown'; retryAfterSec: number; message: string }
  | { ok: false; reason: VerificationFailureReason; message: string };

// ---------------------------------------------------------------------------
// Phone OTP actions (R10.1–10.4, R13.2–13.4)
// ---------------------------------------------------------------------------

/**
 * Start a phone-verification challenge: send an OTP to a normalized phone
 * (R10.1, R10.2).
 *
 * Flow: resolve the session (must be signed in) → normalize the phone to
 * canonical E.164 via {@link normalizePhoneE164} using {@link getDefaultPhoneRegion}
 * (invalid → `invalid_phone`) → delegate to
 * {@link VerificationProvider.startPhoneVerification}, mapping its result onto
 * the action envelope. The phone is deliberately NOT persisted here — that
 * happens at confirm/trial-provision time (task 9.2).
 *
 * Never throws. Provider-level rate limiting (`rate_limited`), not-configured
 * (`not_configured`), and provider-down (`provider_unavailable`) all surface as
 * safe-message envelopes (R13.3/13.4).
 *
 * @param input `{ phone }` — the raw, user-entered phone number.
 */
export async function requestPhoneOtp(input: {
  phone: string;
}): Promise<RequestPhoneOtpResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { ok: false, reason: 'not_signed_in', message: MSG_NOT_SIGNED_IN };
    }

    const phoneE164 = normalizePhoneE164(input?.phone ?? '', getDefaultPhoneRegion());
    if (!phoneE164) {
      return { ok: false, reason: 'invalid_phone', message: MSG_INVALID_PHONE };
    }

    const result = await getVerificationProvider().startPhoneVerification({ phoneE164 });
    if (result.ok) {
      return { ok: true, channel: result.channel, expiresInSec: result.expiresInSec };
    }
    // Provider envelope already carries a user-safe message (no internals).
    return { ok: false, reason: result.reason, message: result.message };
  } catch (err) {
    console.error('[verification] requestPhoneOtp failed:', err);
    return { ok: false, reason: 'unexpected', message: MSG_UNEXPECTED };
  }
}

/**
 * Confirm a submitted OTP code against the active phone challenge (R10.3,
 * R10.4).
 *
 * Flow: resolve the session (must be signed in) → normalize the phone (invalid
 * → `invalid_phone`) → delegate to
 * {@link VerificationProvider.checkPhoneVerification}. On success it returns the
 * canonical `phoneE164` so the caller/pipeline can record the verified phone +
 * identity binding (this action records NOTHING itself). Failures
 * (`invalid_code`, `expired`, `rate_limited`, `not_configured`,
 * `provider_unavailable`) are mapped to safe-message envelopes.
 *
 * The provider already rate-limits sends and caps wrong-code attempts, so no
 * extra server-side guard is added here (R10.4).
 *
 * Never throws.
 *
 * @param input `{ phone, code }` — the raw phone and the submitted code.
 */
export async function confirmPhoneOtp(input: {
  phone: string;
  code: string;
}): Promise<ConfirmPhoneOtpResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { ok: false, reason: 'not_signed_in', message: MSG_NOT_SIGNED_IN };
    }

    const phoneE164 = normalizePhoneE164(input?.phone ?? '', getDefaultPhoneRegion());
    if (!phoneE164) {
      return { ok: false, reason: 'invalid_phone', message: MSG_INVALID_PHONE };
    }

    const code = (input?.code ?? '').trim();
    if (code === '') {
      return { ok: false, reason: 'invalid_code', message: MSG_INVALID_CODE };
    }

    const result = await getVerificationProvider().checkPhoneVerification({
      phoneE164,
      code,
    });
    if (result.ok) {
      // Hand the canonical phone back; the trial pipeline binds it (task 9.2).
      return { ok: true, phoneE164 };
    }
    return { ok: false, reason: result.reason, message: result.message };
  } catch (err) {
    console.error('[verification] confirmPhoneOtp failed:', err);
    return { ok: false, reason: 'unexpected', message: MSG_UNEXPECTED };
  }
}

// ---------------------------------------------------------------------------
// Email verification actions (R7.1, R7.3, R7.4)
// ---------------------------------------------------------------------------

/** Length (bytes) of the random email-verification token before hex encoding. */
const EMAIL_VERIFY_TOKEN_BYTES = 32;

/**
 * Begin email verification for the signed-in groomer (R7.1).
 *
 * Flow: resolve the session (must be signed in) → load the user's email →
 * compute the canonical {@link normalizeEmail} → when Redis is unavailable
 * return a `not_configured` envelope (we can't store the one-time token) →
 * generate a URL-safe random token, store `{ normalizedEmail }` under
 * `keys.emailVerify(token)` with a TTL of `getEmailVerificationTtlMin() * 60`
 * seconds (falling back to {@link TTL.EMAIL_VERIFY}) → build
 * `${NEXT_PUBLIC_APP_URL}/verify-email?token=…` and send it via the existing
 * Resend seam ({@link sendEmailVerification}).
 *
 * Dev-friendly delivery policy: email delivery is best-effort. When Resend is
 * unconfigured the send no-ops and returns `false`; we still return `ok: true`
 * (with `delivered: false` and an explanatory message) because the token IS
 * stored and the flow must not be blocked in dev. A hard `not_configured`
 * envelope is reserved for the one case that genuinely can't proceed: Redis
 * being unavailable to store the token.
 *
 * Never throws.
 */
export async function requestEmailVerification(): Promise<RequestEmailVerificationResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { ok: false, reason: 'not_signed_in', message: MSG_NOT_SIGNED_IN };
    }

    // The token lives in Redis; without it we cannot run the flow at all.
    if (!isRedisConfigured()) {
      return {
        ok: false,
        reason: 'not_configured',
        message: MSG_EMAIL_NOT_CONFIGURED,
      };
    }

    await connectDB();
    const user = await User.findById(session.user.id).select('email').lean<{
      email?: string;
    } | null>();
    if (!user?.email) {
      return { ok: false, reason: 'unexpected', message: MSG_NO_EMAIL };
    }

    const normalizedEmail = normalizeEmail(user.email);

    // URL-safe random token (hex is inherently URL-safe).
    const token = randomBytes(EMAIL_VERIFY_TOKEN_BYTES).toString('hex');

    // TTL from config (minutes → seconds); fall back to the Redis default.
    const ttlMin = getEmailVerificationTtlMin();
    const ttlSeconds =
      Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin * 60 : TTL.EMAIL_VERIFY;

    const record: EmailVerifyRecord = { normalizedEmail };
    await cacheSet(keys.emailVerify(token), record, ttlSeconds);

    const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
    // Send to the user's ORIGINAL (display) email so delivery isn't altered by
    // normalization; the stored identity key stays the normalized form (R9.4).
    const delivered = await sendEmailVerification(user.email, link);

    return {
      ok: true,
      delivered,
      message: delivered ? MSG_EMAIL_SENT : MSG_EMAIL_SENT_DEV,
    };
  } catch (err) {
    console.error('[verification] requestEmailVerification failed:', err);
    return { ok: false, reason: 'unexpected', message: MSG_UNEXPECTED };
  }
}

/**
 * Confirm an email-verification token (R7.3, R7.4).
 *
 * Flow: look up `keys.emailVerify(token)` (missing/expired → invalid/expired
 * envelope) → set `User.emailVerifiedAt = new Date()` for the user whose
 * normalized email matches the stored record, preferring the signed-in session
 * user when present (and only when their normalized email matches, so a token
 * can't verify a different account) → delete the one-time token key → return
 * ok.
 *
 * The token is one-time: it is deleted on success. A signed-in session is NOT
 * required — a user may click the link from any context — but when a session is
 * present we scope the update to that user for safety.
 *
 * Never throws.
 *
 * @param input `{ token }` — the one-time token from the verification link.
 */
export async function confirmEmailVerification(input: {
  token: string;
}): Promise<ConfirmEmailVerificationResult> {
  try {
    const token = (input?.token ?? '').trim();
    if (token === '') {
      return {
        ok: false,
        reason: 'invalid_code',
        message: MSG_EMAIL_LINK_INVALID,
      };
    }

    if (!isRedisConfigured()) {
      return {
        ok: false,
        reason: 'not_configured',
        message: MSG_EMAIL_NOT_CONFIGURED,
      };
    }

    const key = keys.emailVerify(token);
    const record = await cacheGet<EmailVerifyRecord>(key);
    if (!record?.normalizedEmail) {
      // Missing or TTL-expired token.
      return {
        ok: false,
        reason: 'expired',
        message: MSG_EMAIL_LINK_INVALID,
      };
    }

    await connectDB();

    // Resolve the user by the normalized email stored with the token. We match
    // on BOTH the raw and normalized forms: the token's `normalizedEmail` is
    // canonical, but `User.email` is stored lowercased/trimmed (not Gmail-
    // collapsed), so we scan the small set and compare canonically.
    const now = new Date();
    const session = await getServerSession(authOptions);

    let matched = false;
    if (session?.user?.id) {
      // Scope to the signed-in user, but only when their canonical email
      // matches the token — a token must never verify a different account.
      const sessionUser = await User.findById(session.user.id)
        .select('email')
        .lean<{ email?: string } | null>();
      if (sessionUser?.email && normalizeEmail(sessionUser.email) === record.normalizedEmail) {
        await User.updateOne(
          { _id: session.user.id },
          { $set: { emailVerifiedAt: now } }
        );
        matched = true;
      }
    }

    if (!matched) {
      // No (matching) session: find the account whose canonical email matches.
      // `User.email` is lowercased/trimmed; for non-Gmail addresses that equals
      // the normalized form, so a direct lookup covers the common case.
      const user = await User.findOne({ email: record.normalizedEmail })
        .select('_id email')
        .lean<{ _id: unknown; email?: string } | null>();
      if (user?._id) {
        await User.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: now } });
        matched = true;
      }
    }

    if (!matched) {
      // Token was valid but no account resolves — treat as an invalid link
      // rather than leaking that the address is/ isn't registered.
      return {
        ok: false,
        reason: 'invalid_code',
        message: MSG_EMAIL_LINK_INVALID,
      };
    }

    // Burn the one-time token so the link can't be replayed.
    await cacheDel(key);

    return { ok: true, message: MSG_EMAIL_VERIFIED };
  } catch (err) {
    console.error('[verification] confirmEmailVerification failed:', err);
    return { ok: false, reason: 'unexpected', message: MSG_UNEXPECTED };
  }
}

/**
 * Resend the email-verification link with a Redis-backed cooldown (R3.3, R3.4,
 * R9.3, R10.1).
 *
 * This is a thin wrapper over {@link requestEmailVerification}. It adds exactly
 * one thing: a per-identity resend cooldown so a user can't spam the resend
 * button and so the limit holds across Vercel's serverless runtime.
 *
 * Flow:
 *   1. Resolve the session (must be signed in → `not_signed_in` envelope).
 *   2. Load the user's email and compute the canonical {@link normalizeEmail}.
 *   3. If Redis is configured, atomically `SET NX EX 60` the cooldown marker on
 *      `keys.emailVerifyResend(normalizedEmail)` (keyed on the NORMALIZED email,
 *      R9.5). If the marker already exists (cooldown active), read its remaining
 *      TTL and reject with `reason:'cooldown'` and a non-negative
 *      `retryAfterSec` — WITHOUT sending another link.
 *      If Redis is NOT configured, FAIL OPEN: skip the cooldown entirely and
 *      delegate, so a Redis outage never traps the user (R9.2). The underlying
 *      {@link requestEmailVerification} still enforces its own `not_configured`
 *      behavior.
 *   4. Delegate to {@link requestEmailVerification} and map its envelope onto
 *      {@link ResendCooldownResult} (its `ok:true` carries `delivered` +
 *      `message`; its `ok:false` carries `reason` + `message`).
 *
 * Never throws.
 */
export async function resendEmailVerification(): Promise<ResendCooldownResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { ok: false, reason: 'not_signed_in', message: MSG_NOT_SIGNED_IN };
    }

    await connectDB();
    const user = await User.findById(session.user.id).select('email').lean<{
      email?: string;
    } | null>();
    if (!user?.email) {
      return { ok: false, reason: 'unexpected', message: MSG_NO_EMAIL };
    }

    const normalizedEmail = normalizeEmail(user.email);

    // Enforce the resend cooldown ONLY when Redis is available. When it is not,
    // fail open (skip the cooldown) so a Redis outage never leaves the user with
    // no path forward (R9.2); the delegated send still handles `not_configured`.
    if (isRedisConfigured()) {
      const cooldownKey = keys.emailVerifyResend(normalizedEmail);
      const acquired = await getRedis().set(cooldownKey, '1', {
        nx: true,
        ex: TTL.EMAIL_VERIFY_RESEND,
      });

      if (acquired !== 'OK') {
        // Cooldown already active — do NOT send another link (R3.4, R10.1).
        const ttl = await getRedis().ttl(cooldownKey);
        const retryAfterSec = ttl > 0 ? ttl : 0;
        return {
          ok: false,
          reason: 'cooldown',
          retryAfterSec,
          message: MSG_RESEND_COOLDOWN,
        };
      }
    }

    // Cooldown passed (or skipped). Delegate the actual send + mirror its envelope.
    const result = await requestEmailVerification();
    if (result.ok) {
      return { ok: true, delivered: result.delivered, message: result.message };
    }
    return { ok: false, reason: result.reason, message: result.message };
  } catch (err) {
    console.error('[verification] resendEmailVerification failed:', err);
    return { ok: false, reason: 'unexpected', message: MSG_UNEXPECTED };
  }
}
