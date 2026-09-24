'use server';

/**
 * Authentication server actions.
 *
 * These run only on the server ('use server') and re-validate all input with
 * the shared Zod schemas before touching the database, so a bypassed or
 * malformed client submission is still rejected (Requirement 21.1).
 *
 * Design decisions:
 *  - Actions RETURN typed result objects rather than throwing, so forms can
 *    render inline field errors and a generic top-level error without a
 *    try/catch around every call site.
 *  - Registration never reveals whether an email is already taken: a duplicate
 *    email and an unexpected write failure both surface the SAME generic
 *    message (Requirement 1.4).
 *  - On success, `registerGroomer` does NOT sign the user in itself. Signing in
 *    requires the plaintext password and the NextAuth client flow, so the
 *    client calls `signIn('credentials', ...)` after a successful result and
 *    then redirects to `/onboarding` (see the Registration Flow in design.md).
 *
 * _Requirements: 1.1, 1.4, 1.7_
 */
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { registerSchema, loginSchema, type LoginInput } from '@/lib/validators/auth';

/** bcrypt work factor for password hashing. */
const BCRYPT_SALT_ROUNDS = 12;

/**
 * MongoDB duplicate-key error code. Surfaced when a concurrent registration
 * wins the race to insert the same email between our uniqueness check and the
 * insert, thanks to the unique index on `User.email`.
 */
const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Generic, non-leaking error shown for both duplicate emails and unexpected
 * registration failures (Requirement 1.4).
 */
const GENERIC_REGISTER_ERROR =
  'Unable to create account. Please check your details and try again.';

/**
 * Standard result envelope returned by every auth action.
 *
 * - `ok`         — whether the operation succeeded.
 * - `error`      — a top-level, user-facing message when `ok` is false.
 * - `fieldErrors`— per-field validation messages keyed by field name, so forms
 *                  can render errors inline next to each input.
 */
export interface AuthActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Collapse a Zod flattened fieldErrors map (string[] per field) into a
 * single-message-per-field map suitable for inline display.
 */
function firstFieldErrors(
  fieldErrors: Record<string, string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) {
      result[field] = messages[0];
    }
  }
  return result;
}

/**
 * Register a new groomer.
 *
 * Validates the input, ensures the email is available, hashes the password,
 * and atomically-ish creates the User (inactive until onboarding completes)
 * plus its GroomerProfile (onboarding at step 0). On success the client should
 * call `signIn('credentials', ...)` and redirect to `/onboarding`.
 *
 * Never discloses whether the email already exists (Requirement 1.4).
 */
export async function registerGroomer(input: unknown): Promise<AuthActionResult> {
  // 1. Server-side validation (Requirement 21.1).
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: firstFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  const { name, email, password } = parsed.data;

  try {
    await connectDB();

    // 2. Uniqueness check. On a hit we return the SAME generic error used for
    //    unexpected failures so the response can't be used to probe which
    //    emails are registered (Requirement 1.4).
    const existing = await User.findOne({ email }).select('_id').lean();
    if (existing) {
      return { ok: false, error: GENERIC_REGISTER_ERROR };
    }

    // 3. Hash the password before persisting; the plaintext never touches the DB.
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // 4. Create the User (isActive stays false until onboarding completes).
    const user = await User.create({
      name,
      email,
      passwordHash,
      isActive: false,
    });

    // 5. Create the paired GroomerProfile at the start of onboarding.
    try {
      await GroomerProfile.create({
        userId: user._id,
        onboardingStep: 0,
        onboardingComplete: false,
      });
    } catch (profileError) {
      // Roll back the orphaned user so a retry can succeed cleanly.
      await User.deleteOne({ _id: user._id });
      throw profileError;
    }

    return { ok: true };
  } catch (error) {
    // A concurrent insert can still trip the unique index between our check and
    // create; treat it exactly like the duplicate case above (no leak).
    if (isDuplicateKeyError(error)) {
      return { ok: false, error: GENERIC_REGISTER_ERROR };
    }

    console.error('registerGroomer failed:', error);
    return { ok: false, error: GENERIC_REGISTER_ERROR };
  }
}

/**
 * Server-side validation helper for login input.
 *
 * Actual credential verification and the account-lockout policy live in the
 * NextAuth Credentials `authorize` callback, which the client invokes via
 * `signIn('credentials', ...)`. This helper lets a caller (e.g. a form action)
 * validate the login payload shape and normalize the email BEFORE handing it to
 * `signIn`, returning inline field errors on failure without ever confirming
 * whether the credentials are correct (Requirement 1.7).
 */
export async function validateLoginInput(
  input: unknown
): Promise<AuthActionResult & { data?: LoginInput }> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: firstFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Narrow an unknown thrown value to a MongoDB duplicate-key error (code 11000).
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE
  );
}
