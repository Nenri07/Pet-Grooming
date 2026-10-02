import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { normalizePhoneE164 } from '@/lib/identity/phone';

/**
 * Feature: billing-trial-and-payments, Property 9 — phone canonicalization.
 *
 * Property-based tests for the phone-identity pure core
 * (`src/lib/identity/phone.ts`). `normalizePhoneE164(input, defaultRegion)` is a
 * lightweight, dependency-free E.164 normalizer: it strips all non-digit
 * formatting, honours a leading `+` or `00` international prefix, resolves
 * national-format input via a small region→calling-code map (US/CA=1, GB=44,
 * PK=92, AU=61), requires 8–15 digits after the `+`, and returns `null`
 * otherwise.
 *
 * Property 9 (format-invariant + idempotent): every formatting variant of a
 * valid canonical E.164 number — spaces, dashes, parens, dots inserted at
 * arbitrary positions WITHOUT changing the digit sequence or the leading `+` —
 * normalizes back to the same canonical E.164, and the canonical form is a
 * fixed point of the normalizer.
 *
 * Validates: Requirements 10.5
 */

// Formatting characters the normalizer must treat as noise (all non-digit).
const FORMATTING_CHARS = [' ', '-', '(', ')', '.', '\t'] as const;

/**
 * Country codes present in the implementation's region map, paired with the
 * national-number length range that keeps the TOTAL E.164 digit count within
 * the 8–15 bound. (national length = total - countryCode length.)
 *   cc '1'  (len 1): national 7..14
 *   cc '44' (len 2): national 6..13
 *   cc '92' (len 2): national 6..13
 *   cc '61' (len 2): national 6..13
 */
const COUNTRY_CODES = ['1', '44', '92', '61'] as const;

/**
 * Generate a valid canonical E.164 string: '+' + country code + national digits,
 * with the total digit count constrained to [8, 15]. The national part's first
 * digit is forced to be non-zero so it survives the impl's leading-zero trunk
 * strip unchanged (keeps the digit sequence stable for the format-invariance
 * assertion, which uses region 'US'/international `+` paths that never strip).
 */
const canonicalE164Arb: fc.Arbitrary<string> = fc
  .constantFrom(...COUNTRY_CODES)
  .chain((cc) => {
    const minNational = Math.max(1, 8 - cc.length);
    const maxNational = 15 - cc.length;
    return fc
      .integer({ min: minNational, max: maxNational })
      .chain((nationalLen) =>
        fc
          .tuple(
            fc.integer({ min: 1, max: 9 }), // leading national digit, never 0
            fc.array(fc.integer({ min: 0, max: 9 }), {
              minLength: nationalLen - 1,
              maxLength: nationalLen - 1,
            })
          )
          .map(([first, rest]) => `+${cc}${first}${rest.join('')}`)
      );
  });

/**
 * Given a canonical E.164 string, produce an arbitrary that inserts formatting
 * characters at random positions AFTER the leading '+' without touching the
 * digit sequence or the leading '+'.
 */
function formattedVariantArb(canonical: string): fc.Arbitrary<string> {
  const plus = canonical[0]; // '+'
  const digits = canonical.slice(1); // digit run
  const gapCount = digits.length + 1; // positions between/around digits
  return fc
    .array(fc.array(fc.constantFrom(...FORMATTING_CHARS), { maxLength: 3 }), {
      minLength: gapCount,
      maxLength: gapCount,
    })
    .map((gaps) => {
      let out = plus + gaps[0].join('');
      for (let i = 0; i < digits.length; i++) {
        out += digits[i] + gaps[i + 1].join('');
      }
      return out;
    });
}

describe('Feature: billing-trial-and-payments, Property 9: phone normalization is format-invariant and idempotent', () => {
  it('all formatting variants of a valid canonical number normalize to that canonical E.164', () => {
    fc.assert(
      fc.property(
        canonicalE164Arb.chain((canonical) =>
          formattedVariantArb(canonical).map((variant) => ({ canonical, variant }))
        ),
        ({ canonical, variant }) => {
          expect(normalizePhoneE164(variant, 'US')).toBe(canonical);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('is idempotent on canonical input (canonical is a fixed point)', () => {
    fc.assert(
      fc.property(canonicalE164Arb, (canonical) => {
        const once = normalizePhoneE164(canonical, 'US');
        expect(once).toBe(canonical);
        // Feeding the output back through the normalizer is a no-op.
        expect(normalizePhoneE164(once as string, 'US')).toBe(canonical);
      }),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 9: national-format resolution
// examples (anchored against the ACTUAL implementation behavior).
//
// Validates: Requirements 10.5
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 9: national-format resolution examples', () => {
  it("resolves a US national number via region 'US'", () => {
    expect(normalizePhoneE164('(415) 555-2671', 'US')).toBe('+14155552671');
  });

  it("resolves a GB national number with trunk 0 via region 'GB' (impl strips leading zero)", () => {
    // digits: 02079460958 -> strip leading 0 -> 2079460958 -> '44' + that.
    expect(normalizePhoneE164('020 7946 0958', 'GB')).toBe('+442079460958');
  });

  it('honours a leading + international prefix regardless of region', () => {
    expect(normalizePhoneE164('+44 20 7946 0958', 'US')).toBe('+442079460958');
  });

  it("honours a '00' international prefix (stripped, remainder is the full number)", () => {
    expect(normalizePhoneE164('0044 20 7946 0958', 'US')).toBe('+442079460958');
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 9: null cases.
//
// Validates: Requirements 10.5
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 9: implausible input yields null', () => {
  it('empty / whitespace-only input -> null', () => {
    expect(normalizePhoneE164('', 'US')).toBeNull();
    expect(normalizePhoneE164('   ', 'US')).toBeNull();
    expect(normalizePhoneE164('\t \n', 'US')).toBeNull();
  });

  it('too-short (fewer than 8 E.164 digits) -> null', () => {
    // '+' + 7 digits is below the 8-digit minimum.
    expect(normalizePhoneE164('+1234567', 'US')).toBeNull();
  });

  it('national-format input with an unknown region -> null', () => {
    expect(normalizePhoneE164('4155552671', 'ZZ')).toBeNull();
  });

  it('non-digit-only input -> null', () => {
    expect(normalizePhoneE164('abc-def', 'US')).toBeNull();
  });

  it('too-long (more than 15 E.164 digits) -> null', () => {
    expect(normalizePhoneE164('+1234567890123456', 'US')).toBeNull();
  });

  // Property: for ANY canonical number, truncating to <8 total digits yields null.
  it('any digit string shorter than the E.164 minimum -> null (international + prefix)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 7 }),
        (ds) => {
          const tooShort = `+${ds.join('')}`;
          expect(normalizePhoneE164(tooShort, 'US')).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
