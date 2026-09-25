/**
 * Pure unit + property tests for the booking-reference helpers
 * (src/lib/booking/reference.ts). No I/O — the helpers are pure, so these run
 * fast and deterministically (the random body is exercised across many calls).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  generateBookingRef,
  formatBookingRef,
  isValidBookingRef,
  REFERENCE_ALPHABET,
  REFERENCE_PREFIX,
  REFERENCE_BODY_LENGTH,
} from '@/lib/booking/reference';

const REF_PATTERN = new RegExp(
  `^${REFERENCE_PREFIX}-[${REFERENCE_ALPHABET}]{${REFERENCE_BODY_LENGTH}}$`
);

describe('generateBookingRef', () => {
  it('matches the PP-XXXXXX format', () => {
    const ref = generateBookingRef();
    expect(ref).toMatch(REF_PATTERN);
    expect(ref.startsWith('PP-')).toBe(true);
    expect(ref).toHaveLength(3 + REFERENCE_BODY_LENGTH);
  });

  it('never emits the ambiguous characters 0, O, 1, or I', () => {
    for (let i = 0; i < 5000; i += 1) {
      const body = generateBookingRef().slice(3); // drop "PP-"
      expect(body).not.toMatch(/[01OI]/);
    }
  });

  it('only uses characters from the declared alphabet', () => {
    const allowed = new Set(REFERENCE_ALPHABET.split(''));
    for (let i = 0; i < 2000; i += 1) {
      const body = generateBookingRef().slice(3);
      for (const ch of body) {
        expect(allowed.has(ch)).toBe(true);
      }
    }
  });

  it('has reasonable uniqueness across many calls', () => {
    const seen = new Set<string>();
    const N = 20000;
    for (let i = 0; i < N; i += 1) {
      seen.add(generateBookingRef());
    }
    // 32^6 ~ 1.07e9 space; collisions across 20k draws should be extremely rare.
    // Allow a tiny slack to keep the test non-flaky.
    expect(seen.size).toBeGreaterThanOrEqual(N - 5);
  });

  it('always produces a reference that validates', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(isValidBookingRef(generateBookingRef())).toBe(true);
    }
  });
});

describe('isValidBookingRef', () => {
  it('accepts a canonical reference', () => {
    expect(isValidBookingRef('PP-23456A')).toBe(true);
  });

  it('rejects wrong prefix, length, or ambiguous chars', () => {
    expect(isValidBookingRef('XX-23456A')).toBe(false);
    expect(isValidBookingRef('PP-2345')).toBe(false); // too short
    expect(isValidBookingRef('PP-2345678')).toBe(false); // too long
    expect(isValidBookingRef('PP-23456O')).toBe(false); // O excluded
    expect(isValidBookingRef('PP-23456I')).toBe(false); // I excluded
    expect(isValidBookingRef('PP-234560')).toBe(false); // 0 excluded
    expect(isValidBookingRef(42 as unknown)).toBe(false);
  });
});

describe('formatBookingRef', () => {
  it('is a no-op (idempotent) on a canonical reference', () => {
    const ref = 'PP-7K3QW9';
    expect(formatBookingRef(ref)).toBe(ref);
  });

  it('uppercases and strips separators/whitespace', () => {
    expect(formatBookingRef('  pp-7k3qw9 ')).toBe('PP-7K3QW9');
    expect(formatBookingRef('pp 7k3 qw9')).toBe('PP-7K3QW9');
    expect(formatBookingRef('PP_7K3QW9')).toBe('PP-7K3QW9');
  });

  it('drops ambiguous characters that are not in the alphabet', () => {
    // O, I, 0, 1 are removed from the body rather than silently substituted.
    expect(formatBookingRef('PP-7O3I2K')).toBe('PP-732K');
  });

  it('returns empty string for non-string input', () => {
    expect(formatBookingRef(undefined as unknown as string)).toBe('');
  });

  it('round-trips every generated reference unchanged', () => {
    for (let i = 0; i < 1000; i += 1) {
      const ref = generateBookingRef();
      expect(formatBookingRef(ref)).toBe(ref);
    }
  });
});

describe('generateBookingRef (property)', () => {
  it('every generated reference is valid and ambiguity-free', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), () => {
        const ref = generateBookingRef();
        expect(isValidBookingRef(ref)).toBe(true);
        expect(ref.slice(3)).not.toMatch(/[01OI]/);
      }),
      { numRuns: 500 }
    );
  });
});
