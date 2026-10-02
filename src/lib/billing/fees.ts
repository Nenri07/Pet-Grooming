/**
 * Application-fee math — the pure core for Stripe Connect direct charges (Phase 3).
 *
 * A single pure function, no I/O: it takes plain numbers/strings and returns a
 * number, so it is directly unit- and property-testable. Nothing here imports
 * Stripe, Mongoose, or process env — the *rate* is sourced at the call site via
 * `getPlatformFeePercent()` in `src/lib/billing/config.ts` and passed in, which
 * keeps this function a pure function of its arguments.
 *
 * The fee is the `application_fee_amount` routed to the Pawxis platform account
 * on a direct charge created on the groomer's connected account. At launch the
 * configured rate is `0`, so the plumbing is present while nothing is taken; a
 * non-zero percentage can be enabled later purely by configuration (R16.2).
 *
 * _Requirements: 16.2 (application-fee plumbing, fee derived from a configurable
 * rate, 0 at launch, no re-architecting to enable a non-zero percentage)._
 * _Design: Pure Functions → `src/lib/billing/fees.ts` (Property 1: fee bounded,
 * integer, zero-at-zero, monotonic in rate)._
 */

/**
 * Zero-decimal currencies — currencies Stripe treats as having **no** minor
 * subunit, so the "minor unit" amount is already a whole count of the currency
 * (e.g. `100` means ¥100, not ¥1.00). This set is **informational**: it exists
 * for callers that convert a *human* amount into minor units before calling
 * this function. It deliberately does NOT change the arithmetic here, because
 * {@link computeApplicationFee} operates purely on integer minor units — for a
 * zero-decimal currency a "minor unit" simply equals one whole currency unit,
 * so `fee = round(amountMinor * ratePercent / 100)` is already a correct
 * integer count of the smallest unit without any decimal conversion.
 *
 * Lowercased ISO-4217-style codes to match Stripe's convention. Not exhaustive;
 * extend as needed. Kept here (rather than in the signature) so the fee math
 * stays currency-agnostic.
 */
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/**
 * Compute the platform application fee for a direct-charge deposit (R16.2).
 *
 * The fee is computed in the **same minor unit** as `amountMinor` (cents for
 * USD, whole yen for JPY, …), so no decimal conversion is needed:
 * `fee = round(amountMinor * ratePercent / 100)`, then clamped so the result is
 * always a valid, charge-safe integer count of the smallest unit.
 *
 * Defensive clamping (so a bad config or caller can never produce an invalid
 * `application_fee_amount`):
 *   - `amountMinor <= 0` or non-finite  → `0` (nothing to take a fee from).
 *   - `ratePercent <= 0` or non-finite  → `0` (fee disabled; the launch default).
 *   - `ratePercent >= 100`              → treated as exactly `100`.
 *   - After rounding, `fee` is clamped to `0 <= fee <= amountMinor` so the fee
 *     can never exceed the charge nor go negative.
 *
 * The `currency` argument is accepted for signature stability and future
 * currency-specific rounding rules; the arithmetic here is intentionally
 * currency-agnostic because it operates on integer minor units (see
 * {@link ZERO_DECIMAL_CURRENCIES} for why zero-decimal currencies need no
 * special handling in this math).
 *
 * INVARIANTS (hold for any `ratePercent` in `[0,100]` and any currency):
 *   - the result is an integer;
 *   - `0 <= fee <= amountMinor`;
 *   - `fee === 0` when `ratePercent === 0`;
 *   - `fee` is non-decreasing in `ratePercent`.
 *
 * Pure: `(amountMinor, currency, ratePercent) -> number`. No I/O.
 *
 * @param amountMinor The charge amount in the currency's smallest unit
 *                    (cents for USD, whole yen for JPY). Expected to be a
 *                    non-negative integer; non-finite / `<= 0` yields `0`.
 * @param currency    The lowercase currency code (accepted for signature
 *                    stability / future rounding rules; does not affect the math).
 * @param ratePercent The platform fee percent in `[0,100]`. Values `<= 0` (or
 *                    non-finite) disable the fee; values `>= 100` are treated as 100.
 * @returns An integer fee in minor units with `0 <= fee <= amountMinor`.
 */
export function computeApplicationFee(
  amountMinor: number,
  currency: string,
  ratePercent: number
): number {
  // Nothing to take a fee from: non-finite or non-positive charge → 0.
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 0;

  // Fee disabled (launch default) or an invalid/negative rate → 0.
  if (!Number.isFinite(ratePercent) || ratePercent <= 0) return 0;

  // Clamp the rate into [0,100]; a rate at/above 100% means the whole charge.
  const rate = ratePercent >= 100 ? 100 : ratePercent;

  // Fee in the same minor unit as the amount; round fractional minor units.
  const raw = Math.round((amountMinor * rate) / 100);

  // Clamp to [0, amountMinor]: never negative, never more than the charge.
  if (raw <= 0) return 0;
  if (raw >= amountMinor) return amountMinor;
  return raw;
}
