/**
 * Billing configuration accessors (Master Spec §13.3; this feature R16.2, R19.4).
 *
 * Parsed, placeholder-aware readers for the billing-related environment
 * variables. Kept separate from `provider.ts` (which owns the configured/not-
 * configured gates) so the pure fee math in `fees.ts` can stay a pure function
 * of its arguments while the *rate* is sourced here at the call site.
 *
 * Every accessor follows the shared `isSet` convention (empty / `…replace_me`
 * / `your-…` / `price_replace…` placeholders ⇒ "not configured" ⇒ default),
 * mirroring {@link module:lib/billing/provider} and `auth/config.ts` (R19.4).
 */

/**
 * Whether a value is a present, non-placeholder env value.
 *
 * Mirrors the `isSet` classifier in `src/lib/billing/provider.ts` so placeholder
 * handling is consistent across the billing surface (R19.4).
 */
function isSet(value: string | undefined): value is string {
  if (!value) return false;
  const t = value.trim();
  if (t.length === 0) return false;
  // Treat shipped placeholders (…replace_me / your-…) as "not configured".
  if (t.includes('replace_me') || t.startsWith('your-') || t.startsWith('price_replace')) {
    return false;
  }
  return true;
}

/** Launch default for the platform application-fee percent (R16.2). */
const DEFAULT_PLATFORM_FEE_PERCENT = 0;

/**
 * The platform application-fee percent applied to client-deposit direct charges
 * (R16.2). Reads `STRIPE_PLATFORM_FEE_PERCENT`, treating any placeholder/empty
 * value as the default via the shared `isSet` convention.
 *
 * The parsed value is a float CLAMPED to `[0,100]`; any invalid, out-of-range,
 * non-finite, or placeholder value falls back to {@link DEFAULT_PLATFORM_FEE_PERCENT}
 * (`0`). This keeps the fee plumbing present with nothing taken at launch while
 * letting a non-zero percentage be enabled by configuration later.
 *
 * @returns A finite number in `[0,100]`; `0` at launch / on any invalid value.
 */
export function getPlatformFeePercent(): number {
  const raw = process.env.STRIPE_PLATFORM_FEE_PERCENT;
  if (!isSet(raw)) return DEFAULT_PLATFORM_FEE_PERCENT;

  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed)) return DEFAULT_PLATFORM_FEE_PERCENT;

  // Clamp to [0,100].
  if (parsed <= 0) return 0;
  if (parsed >= 100) return 100;
  return parsed;
}
