'use server';

/**
 * Trial provisioning server action — Phase 1 + Phase 2 of the billing/trial
 * system (Design: Stripe Flows (a) — Start no-card trial; Abuse-Prevention
 * Pipeline).
 *
 * Two public entry points:
 *
 *   - {@link startTrial} (Phase 1) provisions the free 14-day no-card trial for
 *     an authenticated groomer DIRECTLY, with no abuse gating. The portal
 *     `BillingView` may still call it. It:
 *       1. authenticates via NextAuth and scopes strictly to `session.user.id`;
 *       2. computes the trial deadline (noon in the groomer's timezone on day
 *          14, via the pure {@link computeTrialDeadline}) off a single `now`;
 *       3. upserts the local `Subscription` row to a `trialing` state, mirroring
 *          `trialEndsAt` to the computed `trialDeadline` so the two never drift;
 *       4. invalidates the cached entitlements so the Pro-trial view takes
 *          effect immediately;
 *       5. delegates the Stripe-side trial recording to the active
 *          {@link BillingProvider}.
 *
 *   - {@link startTrialGated} (Phase 2) is the NEW abuse-gated entry the
 *     registration/trial-start UI (task 10.1) calls. It runs the ordered gate
 *     pipeline (email normalize → disposable-domain → email verified → phone
 *     verified → velocity → identity-binding) and ONLY provisions once every
 *     fail-closed gate passes, reusing the SAME provisioning step as
 *     {@link startTrial} via the shared {@link provisionTrial} helper. The
 *     durable `IdentityBinding` is inserted FIRST (its unique `phoneHash` index
 *     resolves double-submit races), then the trial is provisioned; if
 *     provisioning fails after the binding insert the binding is best-effort
 *     rolled back so a retry can succeed.
 *
 * CRITICAL degradation contract (R1.5): the LOCAL `trialing` row is written
 * regardless of the provider result. When Stripe Billing is Not_Configured the
 * provider is a no-op that reports `not_configured` — logged as non-fatal — and
 * provisioning still succeeds because trial evaluation only needs the local
 * row. Nothing in either entry point throws; both return typed envelopes.
 *
 * _Requirements: 1.1 (start a 14-day no-card trial), 1.2 (deadline = noon on
 * day 14 in the groomer tz), 1.3 (Pro capabilities during the trial), 1.4
 * (decline when an identity-bound trial was already consumed), 1.5 (local
 * trialing recorded even when Stripe Billing is Not_Configured), 7.1/7.2 (email
 * verification required before provisioning), 8.1/8.4 (disposable-domain block;
 * fail-open on load failure), 10.1 (verified phone required), 11.1/11.2
 * (identity binding + decline when already consumed), 12.1/12.2/12.3/12.5
 * (device/IP velocity signals, flag-not-block, fail-open)._
 * _Design: Stripe Flows (a) + Abuse-Prevention Pipeline._
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { getServerSession } from 'next-auth';
import { headers } from 'next/headers';

import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Subscription } from '@/lib/db/models/subscription';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { IdentityBinding } from '@/lib/db/models/identity-binding';
import { User } from '@/lib/db/models/user';
import { computeTrialDeadline } from '@/lib/billing/trial';
import { invalidateEntitlements } from '@/lib/billing/entitlements';
import { getBillingProvider, type BillingResult } from '@/lib/billing/provider';
import {
  getDisposableDomainsSource,
  getPhonePepper,
  getVelocityThreshold,
  getVelocityWindowHours,
  isTwilioVerifyConfigured,
} from '@/lib/identity/config';
import { emailDomain, isDisposableDomain, normalizeEmail } from '@/lib/identity/email';
import { normalizePhoneE164 } from '@/lib/identity/phone';
import {
  identityConsumedTrial,
  shouldFlagVelocity,
  type BindingView,
} from '@/lib/identity/binding';
import { getRedis, isRedisConfigured, keys } from '@/lib/redis';
import { PLANS } from '@/lib/plans';

/** Absolute app base URL for building return/success/cancel links. */
function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
  return `${base}${path}`;
}

/** MongoDB duplicate-key error code (unique-index violation). */
const DUPLICATE_KEY_ERROR_CODE = 11000;

/** Narrow an unknown thrown value to a MongoDB duplicate-key error (code 11000). */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE
  );
}

/**
 * Shared trial-provisioning step used by BOTH {@link startTrial} and
 * {@link startTrialGated} so the Subscription upsert + entitlement invalidation
 * + provider delegation live in exactly one place (no duplication).
 *
 * Writes the local `trialing` Subscription (mirroring `trialEndsAt` to
 * `trialDeadline`), invalidates entitlements, then delegates the Stripe-side
 * recording to the active provider. A provider `not_configured` (or any other
 * non-ok provider reason) is treated as a NON-FATAL degrade: the local row is
 * authoritative, so this returns `{ ok: true, url }` anyway (R1.5).
 *
 * @throws Propagates DB errors to the caller so the caller can decide the
 *   envelope (and, for the gated path, roll back the identity binding). The
 *   public entry points wrap this in try/catch so nothing escapes to the UI.
 */
async function provisionTrial(groomerId: string): Promise<BillingResult> {
  const successUrl = appUrl('/billing?trial=started');

  // Resolve the groomer's timezone so the deadline lands on noon-local on day
  // 14 (R1.2); default to UTC when unset or the profile is missing.
  const profile = await GroomerProfile.findOne({ userId: groomerId })
    .select('timezone')
    .lean<{ timezone?: string } | null>();
  const timezone = profile?.timezone || 'UTC';

  // Single `now` anchors both the start timestamp and the computed deadline.
  const now = new Date();
  const trialStartedAt = now;
  const trialDeadline = computeTrialDeadline(now, timezone);

  // Upsert the local trialing row. `trialEndsAt` mirrors `trialDeadline` so the
  // access-guard (reads trialDeadline) and resolveEntitlements (reads
  // trialEndsAt) never disagree. $setOnInsert fixes the groomer on insert.
  await Subscription.findOneAndUpdate(
    { groomerId },
    {
      $set: {
        plan: 'trial',
        status: 'trialing',
        trialStartedAt,
        trialDeadline,
        trialEndsAt: trialDeadline,
        smsIncluded: PLANS.trial.sms,
      },
      $setOnInsert: { groomerId },
    },
    { upsert: true }
  );

  // The Pro-trial view should take effect immediately, not after the 60s TTL.
  await invalidateEntitlements(groomerId);

  // Delegate the Stripe-side trial recording. When Billing is Not_Configured
  // the provider is a no-op reporting `not_configured`; that is non-fatal — the
  // local trialing row above is what trial evaluation reads (R1.5).
  const providerResult = await getBillingProvider().startTrial({
    groomerId,
    successUrl,
    cancelUrl: appUrl('/billing'),
  });

  if (!providerResult.ok) {
    console.warn(
      `[trial] provider startTrial non-fatal (${providerResult.reason}); local trialing row written.`
    );
    return { ok: true, url: successUrl };
  }

  return providerResult;
}

/**
 * Start the free 14-day Pro trial (no card required) for the authenticated
 * groomer (Design: Stripe Flows (a)). Writes the local `trialing` Subscription,
 * invalidates entitlements, and delegates Stripe recording to the provider.
 *
 * Returns a typed {@link BillingResult} envelope — `{ ok: true, url }` to land
 * on, or `{ ok: false, reason, message }` — and never throws.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.5._
 */
export async function startTrial(): Promise<BillingResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      ok: false,
      reason: 'unknown_groomer',
      message: 'You must be signed in to start a trial.',
    };
  }

  const groomerId = session.user.id;

  try {
    await connectDB();
    return await provisionTrial(groomerId);
  } catch (err) {
    console.error('[trial] startTrial failed:', err);
    return {
      ok: false,
      reason: 'stripe_error',
      message: 'We could not start your trial right now. Please try again in a moment.',
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — gated trial pipeline (startTrialGated)
// ---------------------------------------------------------------------------

/**
 * Serializable input to {@link startTrialGated}, submitted by the trial-start
 * UI. The email comes from the authenticated session user (never trusted from
 * the client); the phone must have ALREADY been verified by the UI via
 * `confirmPhoneOtp` (which returns the canonical `phoneE164`) — we re-affirm
 * trust by requiring a non-empty canonical phone here.
 */
export interface StartTrialGatedInput {
  /** The canonical, already-OTP-verified E.164 phone (from `confirmPhoneOtp`). */
  phoneE164: string;
  /** Opaque, non-PII device fingerprint hash (optional; pipeline proceeds without it). */
  deviceFingerprint?: string;
}

/**
 * The ordered-pipeline reasons a gated trial can be declined, plus the
 * successful provisioning envelope. Every branch is a typed envelope — the
 * pipeline NEVER throws.
 *
 * On success the provisioning {@link BillingResult} is widened with a `flagged`
 * flag carrying the velocity signal through for operator visibility (R12.2/12.3
 * — flagged does NOT block).
 */
export type StartTrialGatedResult =
  | ({ flagged: boolean } & BillingResult)
  | { ok: false; reason: 'not_signed_in'; message: string }
  | { ok: false; reason: 'disposable_email'; message: string }
  | { ok: false; reason: 'email_unverified'; message: string }
  | { ok: false; reason: 'phone_unverified'; message: string }
  | { ok: false; reason: 'trial_already_used'; message: string };

/** Default region for re-validating the (already-canonical) phone, for safety. */
function getDefaultPhoneRegion(): string {
  const raw = process.env.DEFAULT_PHONE_REGION?.trim();
  return raw && raw.length > 0 ? raw.toUpperCase() : 'US';
}

/**
 * Compute the `IdentityBinding` phone hash, matching the exact scheme used by
 * the ledger and the verification seam: `sha256(E.164 + pepper)`. When the
 * pepper is unset/placeholder ({@link getPhonePepper} returns `null`) we hash
 * the E.164 alone — documented weaker-but-functional degrade (the pepper only
 * hardens the hash against offline correlation).
 */
function computePhoneHash(phoneE164: string): string {
  const pepper = getPhonePepper();
  const material = pepper ? `${phoneE164}${pepper}` : phoneE164;
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * Compute an email-derived identity hash used as the identity key when the
 * phone gate is SKIPPED (Twilio unconfigured — R6.3). This is stored in the
 * SAME `IdentityBinding.phoneHash` field so the existing unique index keeps
 * enforcing one-trial-per-identity without a phone (R6.4, R6.5).
 *
 * It mirrors {@link computePhoneHash} exactly — `sha256(material + pepper)`
 * (pepper omitted when {@link getPhonePepper} returns `null`) — so the produced
 * value shares the hash's length/format. A fixed `email:` namespace prefix is
 * mixed in so an email-derived key can never coincide with the hash of a real
 * E.164 phone, keeping the two identity spaces disjoint within the one unique
 * index.
 */
function computeEmailIdentityHash(normalizedEmail: string): string {
  const pepper = getPhonePepper();
  const base = `email:${normalizedEmail}`;
  const material = pepper ? `${base}${pepper}` : base;
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * Mask an IP so only a coarse velocity signal is stored, never precise tracking
 * (R12.4; consistent with the `IdentityBinding.ips` note). IPv4: zero the last
 * octet (`a.b.c.d` → `a.b.c.0`). IPv6: keep the first 4 hextets (the /64
 * network prefix) and zero the rest. Unknown/empty → `'unknown'`.
 */
function maskIp(ip: string): string {
  const trimmed = ip.trim();
  if (!trimmed) return 'unknown';

  // IPv4 (dotted quad).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
    const parts = trimmed.split('.');
    parts[3] = '0';
    return parts.join('.');
  }

  // IPv6 (contains ':') — keep the /64 network prefix, zero the interface id.
  if (trimmed.includes(':')) {
    // Expand to explicit hextets as best-effort; keep the first 4 groups.
    const groups = trimmed.split(':');
    const prefix = groups.slice(0, 4).filter((g) => g.length > 0);
    while (prefix.length < 4) prefix.push('0');
    return `${prefix.join(':')}::`;
  }

  return 'unknown';
}

/** Read the best-effort client IP from forwarded headers (first hop). */
async function clientIpFromHeaders(): Promise<string> {
  try {
    const h = await headers();
    const fwd = h.get('x-forwarded-for');
    if (fwd) {
      const first = fwd.split(',')[0]?.trim();
      if (first) return first;
    }
    const real = h.get('x-real-ip')?.trim();
    return real && real.length > 0 ? real : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * A SMALL built-in disposable-domain blocklist used as the fail-open fallback
 * when `DISPOSABLE_DOMAINS_SOURCE` is unset or its load fails (R8.4). Not
 * exhaustive — the maintainable source (R8.2) is the real list; this just
 * blocks the most common throwaway providers so the gate still has teeth in
 * dev / when the source is missing. Entries are lowercased.
 */
const BUILTIN_DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com',
  '10minutemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'sharklasers.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'yopmail.com',
  'getnada.com',
  'nada.email',
  'maildrop.cc',
  'dispostable.com',
  'trashmail.com',
  'fakeinbox.com',
  'mailnesia.com',
  'mohmal.com',
  'moakt.com',
  'tempinbox.com',
  'spamgourmet.com',
]);

/**
 * Load the disposable-domain blocklist (I/O concern, R8.2). When
 * `getDisposableDomainsSource()` is set it is read best-effort — an `http(s)`
 * source is fetched, otherwise it is treated as a local file path — and parsed
 * as a newline-separated list (blank lines and `#` comments ignored). On ANY
 * failure (unset source, fetch/read error, parse error) this FAILS OPEN by
 * returning the small {@link BUILTIN_DISPOSABLE_DOMAINS} fallback and logging a
 * diagnostic, so a legitimate groomer is never blocked by an infrastructure
 * fault (R8.4). Never throws.
 */
async function loadDisposableDomains(): Promise<ReadonlySet<string>> {
  const source = getDisposableDomainsSource();
  if (!source) {
    // No configured source: use the built-in fallback (not a failure).
    return BUILTIN_DISPOSABLE_DOMAINS;
  }

  try {
    let text: string;
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(source);
      if (!res.ok) {
        throw new Error(`disposable source fetch failed: HTTP ${res.status}`);
      }
      text = await res.text();
    } else {
      text = await fs.readFile(source, 'utf8');
    }

    const domains = text
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    if (domains.length === 0) {
      // Empty/garbage source — fall open to the built-in list.
      console.warn('[trial] disposable-domains source empty; using built-in fallback.');
      return BUILTIN_DISPOSABLE_DOMAINS;
    }

    return new Set(domains);
  } catch (err) {
    // Fail-OPEN (R8.4): record a diagnostic and fall back to the built-in list
    // (rather than skipping the check entirely, which would remove all teeth).
    console.warn('[trial] disposable-domains load failed; using built-in fallback:', err);
    return BUILTIN_DISPOSABLE_DOMAINS;
  }
}

/**
 * Best-effort velocity signal (R12.1/12.2/12.5). INCRs the device + IP counters
 * in Redis with an EXPIRE applied only when a counter is first created (so the
 * window is a true rolling window from the first attempt), reads the counts,
 * and returns whether EITHER exceeds the configured threshold
 * ({@link shouldFlagVelocity}). FAILS OPEN: if Redis is unavailable, or the
 * fingerprint is missing/`'unknown'` (no device signal) and the IP is
 * `'unknown'`, the relevant counter is skipped — a missing signal never blocks
 * (R12.5) and simply contributes no flag.
 *
 * Flagging does NOT block; the caller carries the returned `flagged` through on
 * success for operator review (R12.3).
 */
async function recordVelocityAndFlag(
  fingerprint: string | undefined,
  maskedIp: string
): Promise<boolean> {
  if (!isRedisConfigured()) {
    // No signal store — fail open, contribute no flag (R12.5).
    return false;
  }

  const threshold = getVelocityThreshold();
  const windowSec = getVelocityWindowHours() * 3600;

  /** INCR a counter; set EXPIRE only on first creation (count === 1). */
  async function bump(key: string): Promise<number> {
    const r = getRedis();
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, windowSec);
    }
    return count;
  }

  let flagged = false;
  try {
    // Device counter — only when we actually have a fingerprint signal.
    if (fingerprint && fingerprint !== 'unknown') {
      const devCount = await bump(keys.velDevice(fingerprint));
      if (shouldFlagVelocity(devCount, threshold)) flagged = true;
    }
    // IP counter — only when we resolved a real masked IP.
    if (maskedIp && maskedIp !== 'unknown') {
      const ipCount = await bump(keys.velIp(maskedIp));
      if (shouldFlagVelocity(ipCount, threshold)) flagged = true;
    }
  } catch (err) {
    // Redis blip mid-flight — fail open, keep any flag already computed.
    console.warn('[trial] velocity counter error; proceeding (fail-open):', err);
  }

  return flagged;
}

/**
 * Abuse-gated trial start (Design: Abuse-Prevention Pipeline). Runs the ORDERED
 * gate pipeline below, then provisions via the shared {@link provisionTrial}.
 * The new registration/trial-start UI (task 10.1) calls this; the legacy
 * {@link startTrial} stays available for the portal.
 *
 * ORDERED PIPELINE (fail policy per requirement in parentheses):
 *   1. Auth (fail-closed)        — no session user → `not_signed_in`.
 *   2. Email normalize           — load the session user's email; canonicalize.
 *   3. Disposable-domain (R8)    — block disposable domains; FAIL-OPEN on a
 *                                  blocklist load failure (R8.4).
 *   4. Email verified (R7)       — fail-CLOSED: require `User.emailVerifiedAt`.
 *   5. Phone verified (R6/R10)   — CONDITIONAL on `isTwilioVerifyConfigured()`:
 *                                  when configured, fail-CLOSED and require a
 *                                  non-empty canonical E.164 (re-normalized for
 *                                  safety); when unconfigured, SKIP the gate and
 *                                  treat the phone as absent (R6.2, R6.3).
 *   6. Velocity (R12)            — fail-OPEN, flag-not-block: INCR device + IP
 *                                  counters, compute `flagged`, proceed.
 *   7. Identity binding (R11)    — fail-CLOSED: `identityConsumedTrial` → decline.
 *   8. Provision atomically      — insert `IdentityBinding` FIRST (the unique
 *                                  `phoneHash` field — holding the phone hash
 *                                  when a phone is present, else an
 *                                  email-derived identity hash — resolves
 *                                  double-submit races as `trial_already_used`),
 *                                  THEN provision the trial; on provisioning
 *                                  failure best-effort delete the just-inserted
 *                                  binding so a retry can succeed.
 *
 * Never throws; every branch returns a typed {@link StartTrialGatedResult}.
 *
 * _Requirements: 1.1, 1.4, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 8.1, 8.4, 9.4,
 * 10.1, 11.1, 11.2, 12.1, 12.2, 12.3, 12.5._
 * _Design: Abuse-Prevention Pipeline._
 */
export async function startTrialGated(
  input: StartTrialGatedInput
): Promise<StartTrialGatedResult> {
  try {
    // --- Gate 1: Auth (fail-closed) ---------------------------------------
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return {
        ok: false,
        reason: 'not_signed_in',
        message: 'You must be signed in to start a trial.',
      };
    }
    const groomerId = session.user.id;

    await connectDB();

    // --- Gate 2: Email normalize ------------------------------------------
    const user = await User.findById(groomerId)
      .select('email emailVerifiedAt')
      .lean<{ email?: string; emailVerifiedAt?: Date | null } | null>();
    const rawEmail = user?.email ?? '';
    const normalizedEmail = normalizeEmail(rawEmail);

    // --- Gate 3: Disposable-domain check (R8, fail-OPEN on load failure) ---
    // `loadDisposableDomains` never throws; on a load fault it returns the
    // built-in fallback (fail-open per R8.4), so a disposable hit here is a
    // genuine match, not an infrastructure artefact.
    const blocklist = await loadDisposableDomains();
    const domain = emailDomain(rawEmail);
    if (domain && isDisposableDomain(domain, blocklist)) {
      return {
        ok: false,
        reason: 'disposable_email',
        message: 'Please use a permanent email address.',
      };
    }

    // --- Gate 4: Email verified (R7, fail-CLOSED) -------------------------
    if (!user?.emailVerifiedAt) {
      return {
        ok: false,
        reason: 'email_unverified',
        message: 'Please verify your email first.',
      };
    }

    // --- Gate 5: Phone verified (R6/R10, CONDITIONAL on Twilio) -----------
    // The phone gate is enforced ONLY when Twilio Verify is configured
    // (R6.2). In the launch environment Twilio is unconfigured, so the gate is
    // SKIPPED entirely and the phone is treated as absent (R6.3) — `phoneE164`
    // stays null and the remaining gates run unchanged (R6.4). When Twilio IS
    // configured the gate is fail-CLOSED exactly as before: the UI must have
    // completed `confirmPhoneOtp`, and we re-affirm trust by requiring a
    // non-empty canonical E.164 (re-normalized for safety) (R6.2, R9.4).
    let phoneE164: string | null = null;
    if (isTwilioVerifyConfigured()) {
      phoneE164 = normalizePhoneE164(input?.phoneE164 ?? '', getDefaultPhoneRegion());
      if (!phoneE164) {
        return {
          ok: false,
          reason: 'phone_unverified',
          message: 'Please verify your phone number first.',
        };
      }
    }

    // --- Gate 6: Velocity (R12, fail-OPEN, flag-not-block) ----------------
    const fingerprint = input?.deviceFingerprint?.trim() || undefined;
    const maskedIp = maskIp(await clientIpFromHeaders());
    const flagged = await recordVelocityAndFlag(fingerprint, maskedIp);

    // --- Gate 7: Identity-binding check (R11, fail-CLOSED) ----------------
    // The identity key is the phone hash when a verified phone is present, else
    // (phone gate skipped — Twilio unconfigured) an email-derived hash so the
    // one-trial-per-identity guarantee still holds without a phone (R6.4,
    // R6.5). Because the ledger's ONLY unique index is on `phoneHash`, the
    // email-derived key is stored IN that same `phoneHash` field — the unique
    // index then enforces uniqueness over whichever identity space applies, and
    // the two spaces never collide (the email hash is namespaced with an
    // `email:` prefix; see `computeEmailIdentityHash`).
    const now = new Date();
    const identityKey = phoneE164
      ? computePhoneHash(phoneE164)
      : computeEmailIdentityHash(normalizedEmail);
    const existing = await IdentityBinding.findOne({ phoneHash: identityKey })
      .select('firstTrialAt bindingExpiresAt')
      .lean<BindingView | null>();
    if (identityConsumedTrial(existing, now)) {
      return {
        ok: false,
        reason: 'trial_already_used',
        message: 'This phone number has already used a free trial.',
      };
    }

    // --- Gate 8: Provision atomically -------------------------------------
    // Insert the durable binding FIRST so the unique `phoneHash` index resolves
    // double-submit / re-register races: a concurrent loser hits a duplicate-key
    // error, which we treat as "already consumed" (R1.4 / R11.2).
    try {
      await IdentityBinding.create({
        normalizedEmail,
        // Stored in the unique `phoneHash` field: a real phone hash when a
        // phone is present, else the email-derived identity hash (R6.4, R6.5).
        phoneHash: identityKey,
        firstTrialAt: now,
        bindingExpiresAt: null,
        deviceFingerprints: fingerprint ? [fingerprint] : [],
        ips: maskedIp && maskedIp !== 'unknown' ? [maskedIp] : [],
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return {
          ok: false,
          reason: 'trial_already_used',
          message: 'This phone number has already used a free trial.',
        };
      }
      throw err;
    }

    // ONLY after the binding insert succeeds, provision the trial (reusing the
    // Phase-1 provisioning). If provisioning fails AFTER the binding insert we
    // best-effort DELETE the just-inserted binding so the trial isn't lost on a
    // retry — PREFERRED over leaving an orphan binding that would read as
    // consumed. (Trade-off: in the rare window where the rollback itself fails,
    // the binding survives and a retry reads as already-consumed — acceptable,
    // and logged.)
    try {
      const result = await provisionTrial(groomerId);
      return { flagged, ...result };
    } catch (provisionErr) {
      console.error(
        '[trial] provisioning failed after binding insert; rolling back binding:',
        provisionErr
      );
      try {
        await IdentityBinding.deleteOne({ phoneHash: identityKey });
      } catch (rollbackErr) {
        console.error(
          '[trial] binding rollback failed; binding persists (retry will read as consumed):',
          rollbackErr
        );
      }
      return {
        flagged,
        ok: false,
        reason: 'stripe_error',
        message:
          'We could not start your trial right now. Please try again in a moment.',
      };
    }
  } catch (err) {
    console.error('[trial] startTrialGated failed:', err);
    return {
      flagged: false,
      ok: false,
      reason: 'stripe_error',
      message: 'We could not start your trial right now. Please try again in a moment.',
    };
  }
}
