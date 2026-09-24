import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { isValidPassword } from '@/lib/validators/auth';

// Feature: pawport, Property 9: Registration password validation
//
// For any string, the registration system SHALL accept it as a valid password
// if and only if it has at least 8 characters, contains at least one uppercase
// letter, at least one lowercase letter, and at least one digit.
//
// Validates: Requirements 1.1

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '0123456789'.split('');

/** Independent oracle mirroring the four password rules directly. */
function oracle(s: string): boolean {
  return s.length >= 8 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);
}

// Generator for strings guaranteed to satisfy ALL four rules: at least one
// uppercase, one lowercase, one digit, plus arbitrary padding, all shuffled and
// padded to length >= 8.
const validPasswordArb = fc
  .tuple(
    fc.constantFrom(...UPPERCASE),
    fc.constantFrom(...LOWERCASE),
    fc.constantFrom(...DIGITS),
    // Arbitrary extra characters to make the input diverse.
    fc.string({ minLength: 5, maxLength: 30 })
  )
  .chain(([upper, lower, digit, rest]) => {
    const chars = [upper, lower, digit, ...rest.split('')];
    // Shuffle so the required characters aren't always in the same position.
    return fc.shuffledSubarray(chars, { minLength: chars.length, maxLength: chars.length });
  })
  .map((chars) => chars.join(''));

describe('Feature: pawport, Property 9: Registration password validation', () => {
  it('accepts any string that satisfies all four rules (positive property)', () => {
    fc.assert(
      fc.property(validPasswordArb, (password) => {
        // Sanity-check the generator against the independent oracle.
        expect(oracle(password)).toBe(true);
        expect(isValidPassword(password)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('matches an independent oracle for arbitrary strings (iff property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const expected = s.length >= 8 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);
        expect(isValidPassword(s)).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it('rejects passwords missing an uppercase letter', () => {
    // Compose only from lowercase + digits, length >= 8: fails on uppercase only.
    const noUpperArb = fc
      .tuple(
        fc.constantFrom(...LOWERCASE),
        fc.constantFrom(...DIGITS),
        fc.array(fc.constantFrom(...LOWERCASE, ...DIGITS), { minLength: 6, maxLength: 30 })
      )
      .map(([lower, digit, rest]) => [lower, digit, ...rest].join(''));

    fc.assert(
      fc.property(noUpperArb, (password) => {
        expect(oracle(password)).toBe(false);
        expect(isValidPassword(password)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects passwords missing a lowercase letter', () => {
    const noLowerArb = fc
      .tuple(
        fc.constantFrom(...UPPERCASE),
        fc.constantFrom(...DIGITS),
        fc.array(fc.constantFrom(...UPPERCASE, ...DIGITS), { minLength: 6, maxLength: 30 })
      )
      .map(([upper, digit, rest]) => [upper, digit, ...rest].join(''));

    fc.assert(
      fc.property(noLowerArb, (password) => {
        expect(oracle(password)).toBe(false);
        expect(isValidPassword(password)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects passwords missing a digit', () => {
    const noDigitArb = fc
      .tuple(
        fc.constantFrom(...UPPERCASE),
        fc.constantFrom(...LOWERCASE),
        fc.array(fc.constantFrom(...UPPERCASE, ...LOWERCASE), { minLength: 6, maxLength: 30 })
      )
      .map(([upper, lower, rest]) => [upper, lower, ...rest].join(''));

    fc.assert(
      fc.property(noDigitArb, (password) => {
        expect(oracle(password)).toBe(false);
        expect(isValidPassword(password)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects passwords shorter than 8 characters even with all classes present', () => {
    // At least one of each class but total length 3-7: fails on length only.
    const tooShortArb = fc
      .tuple(
        fc.constantFrom(...UPPERCASE),
        fc.constantFrom(...LOWERCASE),
        fc.constantFrom(...DIGITS),
        fc.array(fc.constantFrom(...UPPERCASE, ...LOWERCASE, ...DIGITS), {
          minLength: 0,
          maxLength: 4,
        })
      )
      .map(([upper, lower, digit, rest]) => [upper, lower, digit, ...rest].join(''))
      .filter((s) => s.length < 8);

    fc.assert(
      fc.property(tooShortArb, (password) => {
        expect(oracle(password)).toBe(false);
        expect(isValidPassword(password)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
