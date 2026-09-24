/**
 * Zod schemas and pure helpers for groomer authentication input.
 *
 * These schemas are the single source of truth for the *shape* and *rules* of
 * registration and login input. They are consumed on the client (React Hook
 * Form) and re-validated server-side inside the auth server actions so that a
 * bypassed or malformed client submission is still rejected (Requirement 21.1).
 *
 * The password policy — at least 8 characters with at least one uppercase
 * letter, one lowercase letter, and one digit — is expressed both as a Zod
 * schema (`passwordSchema`) and as a pure predicate (`isValidPassword`) built
 * from the exact same rules, so the Property 9 test in task 2.5 can exercise
 * the rule set directly without constructing a Zod pipeline.
 *
 * _Requirements: 1.1, 1.4, 1.7_
 */
import { z } from 'zod';

/** Minimum password length required by the registration policy. */
export const PASSWORD_MIN_LENGTH = 8;

/** Requires at least one lowercase letter. */
const HAS_LOWERCASE = /[a-z]/;
/** Requires at least one uppercase letter. */
const HAS_UPPERCASE = /[A-Z]/;
/** Requires at least one digit. */
const HAS_DIGIT = /[0-9]/;

/**
 * Pure predicate encoding the full password policy: minimum length plus at
 * least one uppercase, one lowercase, and one digit.
 *
 * This is deliberately dependency-free (no Zod) so it can be reused directly by
 * the Property 9 password-validation test and by any other callers that need
 * to check a password without materializing validation errors.
 */
export function isValidPassword(password: string): boolean {
  if (typeof password !== 'string') return false;
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    HAS_LOWERCASE.test(password) &&
    HAS_UPPERCASE.test(password) &&
    HAS_DIGIT.test(password)
  );
}

/**
 * Password schema mirroring {@link isValidPassword}. Each rule is a separate
 * refinement so forms can surface a specific message per failing rule.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .refine((value) => HAS_UPPERCASE.test(value), {
    message: 'Password must contain at least one uppercase letter.',
  })
  .refine((value) => HAS_LOWERCASE.test(value), {
    message: 'Password must contain at least one lowercase letter.',
  })
  .refine((value) => HAS_DIGIT.test(value), {
    message: 'Password must contain at least one digit.',
  });

/**
 * Registration input: display name, email, and a policy-compliant password.
 * Email is lowercased/trimmed so it matches the normalized form stored on the
 * User model and used for uniqueness checks.
 */
export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Name is required.' })
    .max(100, { message: 'Name must be at most 100 characters.' }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { message: 'Email must be at most 254 characters.' })
    .email({ message: 'Enter a valid email address.' }),
  password: passwordSchema,
});

/**
 * Login input. The password here is intentionally NOT run through the full
 * policy: existing accounts must be able to authenticate regardless of any
 * future policy change, and the actual credential check happens in NextAuth.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { message: 'Email must be at most 254 characters.' })
    .email({ message: 'Enter a valid email address.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
});

/** Parsed, validated registration input. */
export type RegisterInput = z.infer<typeof registerSchema>;

/** Parsed, validated login input. */
export type LoginInput = z.infer<typeof loginSchema>;
