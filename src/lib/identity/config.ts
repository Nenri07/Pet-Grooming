/**
 * Identity / trial-abuse-prevention configuration accessors
 * (this feature R13.1, R19.4; design "Configuration / Environment").
 *
 * Parsed, placeholder-aware readers for the Phase 2 environment variables that
 * drive the abuse-prevention pipeline (phone hashing, phone OTP, disposable
 * email blocklist, trial velocity, email-verification TTL). Kept separate from
 * the pipeline/seam modules (which own the "configured / not-configured" gates
 * and behaviour) so the pure core stays a pure function of its arguments while
 * the *values* are sourced here at the call site.
 *
 * Every accessor follows the shared `isSet` convention (empty / `…replace_me`
 * / `your-…` / `price_replace…` placeholders ⇒ "not configured" ⇒ default /
 * `null`), mirroring {@link module:lib/billing/config} and
 * {@link module:lib/billing/provider} (R19.4).
 *
 * These accessors are compile-only seams at this stage: they are defined here
 * and consumed by the pipeline/provider wiring in later tasks (8.x / 9.x). They
 * are pure with respect to their arguments and read only from `process.env`.
 */

/**
 * Whether a value is a present, non-placeholder env value.
 *
 * Mirrors the `isSet` classifier in `src/lib/billing/provider.ts` and
 * `src/lib/billing/config.ts` so placeholder handling is consistent across the
 * whole surface (R19.4).
 */
function isSet(value: string | undefined): value is string {
  if (!value) return false;
  const t = value.trim();
  if (t.length === 0) return false;
  // Treat shipped placeholders (…replace_me / your-… / price_replace…) as
  // "not configured".
  if (t.includes('replace_me') || t.startsWith('your-') || t.startsWith('price_replace')) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default max trial creations per device/IP in the window (R12.3). */
const DEFAULT_VELOCITY_THRESHOLD = 3;
/** Default velocity window length in hours (R12.3). */
const DEFAULT_VELOCITY_WINDOW_HOURS = 24;
/** Default minutes an email-verification token stays valid. */
const DEFAULT_EMAIL_VERIFICATION_TTL_MIN = 30;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * The server-only secret pepper mixed into the phone hash
 * (`sha256(E.164 + pepper)`) stored in the IdentityBinding ledger (R11, R19.1).
 *
 * Reads `IDENTITY_PHONE_PEPPER`, treating any placeholder/empty value as "not
 * configured". When `null`, callers MUST degrade: phone-hash identity binding
 * is disabled (log + fail-open on hashing) so the app keeps working while
 * duplicate-trial detection by phone is weakened.
 *
 * @returns The trimmed pepper, or `null` when unset / placeholder.
 */
export function getPhonePepper(): string | null {
  const raw = process.env.IDENTITY_PHONE_PEPPER;
  return isSet(raw) ? raw.trim() : null;
}

/**
 * Whether Twilio Verify is configured for phone OTP (R10, R13.1).
 *
 * Reads `TWILIO_VERIFY_SERVICE_SID` through the shared `isSet` convention. When
 * `true`, the verification seam uses `TwilioVerifyProvider`; when `false`, it
 * falls back to the existing SMS-provider OTP, then to a Not_Configured state.
 *
 * @returns `true` iff a non-placeholder Verify service SID is present.
 */
export function isTwilioVerifyConfigured(): boolean {
  return isSet(process.env.TWILIO_VERIFY_SERVICE_SID);
}

/**
 * Optional path or URL to a maintainable disposable-email domain blocklist
 * (R8.2). The actual loading is an I/O concern handled elsewhere; this accessor
 * only surfaces the configured source.
 *
 * Reads `DISPOSABLE_DOMAINS_SOURCE`, treating any placeholder/empty value as
 * "not configured". When `null`, callers fall back to a small built-in list.
 *
 * @returns The trimmed source path/URL, or `null` when unset / placeholder.
 */
export function getDisposableDomainsSource(): string | null {
  const raw = process.env.DISPOSABLE_DOMAINS_SOURCE;
  return isSet(raw) ? raw.trim() : null;
}

/**
 * Max trial creations per device fingerprint / IP within the velocity window
 * before an attempt is flagged (R12.3).
 *
 * Reads `TRIAL_VELOCITY_THRESHOLD`, treating any placeholder/empty value as the
 * default via the shared `isSet` convention. The parsed value is an integer
 * CLAMPED to `>= 0`; any invalid, non-finite, or placeholder value falls back
 * to {@link DEFAULT_VELOCITY_THRESHOLD} (`3`).
 *
 * @returns A non-negative integer; `3` on any invalid value.
 */
export function getVelocityThreshold(): number {
  const raw = process.env.TRIAL_VELOCITY_THRESHOLD;
  if (!isSet(raw)) return DEFAULT_VELOCITY_THRESHOLD;

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_VELOCITY_THRESHOLD;

  // Clamp to >= 0.
  return parsed < 0 ? 0 : parsed;
}

/**
 * The velocity window length in hours over which the counts accumulate
 * (R12.3).
 *
 * Reads `TRIAL_VELOCITY_WINDOW_HOURS`, treating any placeholder/empty value as
 * the default via the shared `isSet` convention. The parsed value is an integer
 * CLAMPED to `> 0`; any invalid, non-finite, non-positive, or placeholder value
 * falls back to {@link DEFAULT_VELOCITY_WINDOW_HOURS} (`24`).
 *
 * @returns A positive integer; `24` on any invalid value.
 */
export function getVelocityWindowHours(): number {
  const raw = process.env.TRIAL_VELOCITY_WINDOW_HOURS;
  if (!isSet(raw)) return DEFAULT_VELOCITY_WINDOW_HOURS;

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_VELOCITY_WINDOW_HOURS;

  return parsed;
}

/**
 * Minutes an email-verification token (`evf:{token}`) stays valid.
 *
 * Reads `EMAIL_VERIFICATION_TTL_MIN`, treating any placeholder/empty value as
 * the default via the shared `isSet` convention. The parsed value is an integer
 * CLAMPED to `> 0`; any invalid, non-finite, non-positive, or placeholder value
 * falls back to {@link DEFAULT_EMAIL_VERIFICATION_TTL_MIN} (`30`).
 *
 * @returns A positive integer number of minutes; `30` on any invalid value.
 */
export function getEmailVerificationTtlMin(): number {
  const raw = process.env.EMAIL_VERIFICATION_TTL_MIN;
  if (!isSet(raw)) return DEFAULT_EMAIL_VERIFICATION_TTL_MIN;

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EMAIL_VERIFICATION_TTL_MIN;

  return parsed;
}
