/**
 * Phone canonicalization — pure core (Requirement 10.5).
 *
 * R10.5: "THE Pawxis_System SHALL store the phone number in a normalized
 * canonical form so that formatting variations of one number map to a single
 * identity." This module provides that canonical form as E.164 (e.g.
 * `+14155552671`), which is used downstream to derive the identity-binding
 * `phoneHash` (sha256(E.164 + pepper)).
 *
 * Implementation path taken: LIGHTWEIGHT PURE FALLBACK.
 * `libphonenumber-js` is not a project dependency, so rather than add one we
 * implement a pragmatic, dependency-free normalizer behind a stable signature.
 * The signature mirrors how a `libphonenumber-js`-backed implementation would
 * look, so the robust library can be dropped in later without touching callers:
 *
 *   // Preferred robust path (if libphonenumber-js is ever installed):
 *   import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
 *   const p = parsePhoneNumberFromString(input, defaultRegion as CountryCode);
 *   return p?.isValid() ? p.number : null;
 *
 * The fallback below is NOT a full E.164 validator — it does format
 * normalization plus a plausibility length check (8–15 digits per E.164) and a
 * minimal region→calling-code map. It is sufficient for identity collapsing of
 * well-formed inputs; swap in `libphonenumber-js` for exhaustive validation.
 *
 * Pure: no I/O, no clock, no environment access.
 */

/**
 * Minimal region (ISO 3166-1 alpha-2) → E.164 calling code map.
 *
 * This is intentionally small — only the regions this product currently serves.
 * National-format input is only resolvable for a region present here; unknown
 * regions with national-format input yield `null`. (A `libphonenumber-js`
 * swap-in would remove the need for this map entirely.)
 */
const REGION_CALLING_CODE: Readonly<Record<string, string>> = {
  US: '1',
  CA: '1',
  GB: '44',
  PK: '92',
  AU: '61',
};

/** Lowest/highest plausible E.164 digit counts (excluding the leading '+'). */
const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;

/**
 * Normalize a phone number to canonical E.164, or return `null` when the input
 * is not a plausible phone number (R10.5).
 *
 * Behavior (lightweight fallback):
 * - Already-canonical E.164 input is returned unchanged (idempotent):
 *   `normalizePhoneE164('+14155552671', 'US') === '+14155552671'`.
 * - International input (leading `+` or `00` prefix) keeps its country code; all
 *   non-digit formatting (spaces, dashes, parentheses, dots) is stripped.
 * - National-format input (no `+`) is prefixed with the calling code for
 *   `defaultRegion` when that region is in the minimal map; otherwise `null`.
 * - The result must be 8–15 digits after the `+`, else `null`.
 *
 * @param input - Raw user-entered phone, any common formatting.
 * @param defaultRegion - ISO 3166-1 alpha-2 region (e.g. `'US'`) used to resolve
 *   national-format input. Case-insensitive.
 * @returns Canonical E.164 string (`+` followed by 8–15 digits) or `null`.
 */
export function normalizePhoneE164(input: string, defaultRegion: string): string | null {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  // Detect international intent: a leading '+' or a leading '00' trunk prefix.
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly === '') return null;

  let e164Digits: string;

  if (hasPlus) {
    // '+' already present: the digits are the full international number.
    e164Digits = digitsOnly;
  } else if (digitsOnly.startsWith('00')) {
    // '00' is the international call prefix in many regions; treat the remainder
    // as the full international number.
    e164Digits = digitsOnly.slice(2);
  } else {
    // National format: resolve via the default region's calling code.
    const region = defaultRegion?.trim().toUpperCase();
    const callingCode = region ? REGION_CALLING_CODE[region] : undefined;
    if (!callingCode) return null;

    // Strip a single leading national trunk '0' if present (e.g. GB/AU locals).
    const national = digitsOnly.replace(/^0+/, '');
    if (national === '') return null;

    e164Digits = callingCode + national;
  }

  if (e164Digits.length < MIN_E164_DIGITS || e164Digits.length > MAX_E164_DIGITS) {
    return null;
  }

  return `+${e164Digits}`;
}
