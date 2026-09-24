/**
 * Zod schemas for the public booking flow.
 *
 * `petInfoSchema` is the single source of truth for the shape and rules of
 * Step 1 (Pet Information). It is consumed on the client via React Hook Form's
 * `zodResolver` in `StepPetInfo`, and is intended to be re-validated
 * server-side when the booking is finalized so a bypassed or malformed client
 * submission is still rejected (Requirement 21.1).
 *
 * Field rules mirror Requirement 3.2 exactly:
 *  - name: required, 1..50 characters
 *  - photoUrl: optional string (the real UploadThing integration lands in task
 *    18; for now this accepts an optional URL and no-ops otherwise)
 *  - breed: required, one of the predefined `BREED_VALUES`
 *  - weight: required numeric, 1..200
 *  - weightUnit: 'lbs' | 'kg'
 *  - age: required numeric, 0..30
 *  - temperament: required enum (calm | nervous | aggressive | friendly)
 *  - coatCondition: required enum (smooth | double | wire | curly | long |
 *    matted)
 *  - specialFlags: optional string[] (each a predefined `SPECIAL_FLAG_VALUES`)
 *  - notes: optional, max 500 characters
 *
 * _Requirements: 3.2, 3.4, 21.1_
 */
import { z } from 'zod';
import { BREED_VALUES } from '@/config/breeds';
import { TEMPERAMENT_VALUES } from '@/config/temperaments';
import { COAT_CONDITION_VALUES } from '@/config/coat-conditions';
import { SPECIAL_FLAG_VALUES } from '@/config/special-flags';

/** Maximum length of the pet name (Requirement 3.2). */
export const PET_NAME_MAX_LENGTH = 50;
/** Minimum / maximum pet weight, unit-agnostic (Requirement 3.2). */
export const PET_WEIGHT_MIN = 1;
export const PET_WEIGHT_MAX = 200;
/** Minimum / maximum pet age in years (Requirement 3.2). */
export const PET_AGE_MIN = 0;
export const PET_AGE_MAX = 30;
/** Maximum length of the free-text notes field (Requirement 3.2). */
export const PET_NOTES_MAX_LENGTH = 500;

/**
 * Pet Information schema (Step 1 of the booking flow).
 *
 * Numeric fields use `z.coerce.number()` so values arriving as strings from an
 * HTML `<input type="number">` are coerced before range checks run, while the
 * inferred type remains `number`.
 */
export const petInfoSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Pet name is required.' })
    .max(PET_NAME_MAX_LENGTH, {
      message: `Pet name must be at most ${PET_NAME_MAX_LENGTH} characters.`,
    }),

  // Photo upload integration (UploadThing) is wired in task 18. For now we
  // accept an optional URL string and treat empty input as "no photo".
  photoUrl: z
    .string()
    .trim()
    .url({ message: 'Enter a valid image URL.' })
    .optional()
    .or(z.literal('')),

  breed: z.enum(BREED_VALUES, {
    message: 'Select a breed from the list.',
  }),

  weight: z.coerce
    .number({ message: 'Enter a weight.' })
    .min(PET_WEIGHT_MIN, {
      message: `Weight must be at least ${PET_WEIGHT_MIN}.`,
    })
    .max(PET_WEIGHT_MAX, {
      message: `Weight must be at most ${PET_WEIGHT_MAX}.`,
    }),

  weightUnit: z.enum(['lbs', 'kg'], {
    message: 'Select a weight unit.',
  }),

  age: z.coerce
    .number({ message: 'Enter an age.' })
    .min(PET_AGE_MIN, { message: `Age must be at least ${PET_AGE_MIN}.` })
    .max(PET_AGE_MAX, { message: `Age must be at most ${PET_AGE_MAX}.` }),

  temperament: z.enum(TEMPERAMENT_VALUES, {
    message: 'Select a temperament.',
  }),

  coatCondition: z.enum(COAT_CONDITION_VALUES, {
    message: 'Select a coat condition.',
  }),

  specialFlags: z.array(z.enum(SPECIAL_FLAG_VALUES)).optional(),

  notes: z
    .string()
    .trim()
    .max(PET_NOTES_MAX_LENGTH, {
      message: `Notes must be at most ${PET_NOTES_MAX_LENGTH} characters.`,
    })
    .optional()
    .or(z.literal('')),
});

/**
 * Parsed, validated Step 1 pet information (the schema's OUTPUT type). Numeric
 * fields are `number` here because `z.coerce.number()` has run.
 */
export type PetInfoFormValues = z.output<typeof petInfoSchema>;

/**
 * The schema's INPUT type, i.e. the raw field values React Hook Form holds
 * before Zod coercion. Because `weight`/`age` use `z.coerce.number()`, their
 * input side accepts the `unknown` that an HTML input provides; RHF's `useForm`
 * is parameterized with this type so the `zodResolver` (which is typed
 * input→output under Zod v4) lines up exactly.
 */
export type PetInfoFormInput = z.input<typeof petInfoSchema>;

/**
 * Owner Details & Service Address schema (Step 2 of the booking flow).
 *
 * `ownerDetailsSchema` is the single source of truth for the shape and rules of
 * Step 2. It is consumed on the client via React Hook Form's `zodResolver` in
 * `StepOwnerDetails`, and is intended to be re-validated server-side when the
 * booking is finalized so a bypassed or malformed client submission is still
 * rejected (Requirement 21.1).
 *
 * Field rules mirror Requirement 4.2 exactly:
 *  - name: required, 1..100 characters (Client full name)
 *  - email: required, valid email format, max 254 characters
 *  - phone: required, 7..15 digits with an optional single leading '+'
 *  - address.street: required, 1..200 characters
 *  - address.city: required, 1..100 characters
 *  - address.state: required, 1..100 characters (state/province)
 *  - address.postalCode: required, 1..20 characters
 *
 * The schema nests the address fields under `address` so its output aligns
 * directly with the `OwnerDetailsInput` shape dispatched into booking state.
 *
 * _Requirements: 4.2, 4.4, 21.1_
 */

/** Maximum length of the owner's full name (Requirement 4.2). */
export const OWNER_NAME_MAX_LENGTH = 100;
/** Maximum length of the owner's email (Requirement 4.2). */
export const OWNER_EMAIL_MAX_LENGTH = 254;
/** Minimum / maximum number of phone digits, excluding the optional '+' (Requirement 4.2). */
export const OWNER_PHONE_MIN_DIGITS = 7;
export const OWNER_PHONE_MAX_DIGITS = 15;
/** Maximum length of the street address (Requirement 4.2). */
export const ADDRESS_STREET_MAX_LENGTH = 200;
/** Maximum length of the city (Requirement 4.2). */
export const ADDRESS_CITY_MAX_LENGTH = 100;
/** Maximum length of the state/province (Requirement 4.2). */
export const ADDRESS_STATE_MAX_LENGTH = 100;
/** Maximum length of the postal code (Requirement 4.2). */
export const ADDRESS_POSTAL_CODE_MAX_LENGTH = 20;

/**
 * Phone validation: an optional single leading '+' followed by 7..15 digits.
 * The user may type spaces, hyphens, or parentheses; those are stripped before
 * the digit count is checked so common formatting does not spuriously fail.
 */
const PHONE_DIGITS_ONLY = /[^\d+]/g;
const PHONE_PATTERN = new RegExp(
  `^\\+?\\d{${OWNER_PHONE_MIN_DIGITS},${OWNER_PHONE_MAX_DIGITS}}$`
);

export const ownerDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Full name is required.' })
    .max(OWNER_NAME_MAX_LENGTH, {
      message: `Name must be at most ${OWNER_NAME_MAX_LENGTH} characters.`,
    }),

  email: z
    .string()
    .trim()
    .min(1, { message: 'Email is required.' })
    .max(OWNER_EMAIL_MAX_LENGTH, {
      message: `Email must be at most ${OWNER_EMAIL_MAX_LENGTH} characters.`,
    })
    .email({ message: 'Enter a valid email address.' }),

  phone: z
    .string()
    .trim()
    .min(1, { message: 'Phone number is required.' })
    // Normalize away common separators (spaces, hyphens, parentheses) so only
    // an optional leading '+' and the digits remain before pattern checking.
    .transform((value) => value.replace(PHONE_DIGITS_ONLY, ''))
    .pipe(
      z.string().regex(PHONE_PATTERN, {
        message: `Enter a valid phone number (${OWNER_PHONE_MIN_DIGITS}\u2013${OWNER_PHONE_MAX_DIGITS} digits, optional leading +).`,
      })
    ),

  address: z.object({
    street: z
      .string()
      .trim()
      .min(1, { message: 'Street address is required.' })
      .max(ADDRESS_STREET_MAX_LENGTH, {
        message: `Street must be at most ${ADDRESS_STREET_MAX_LENGTH} characters.`,
      }),

    city: z
      .string()
      .trim()
      .min(1, { message: 'City is required.' })
      .max(ADDRESS_CITY_MAX_LENGTH, {
        message: `City must be at most ${ADDRESS_CITY_MAX_LENGTH} characters.`,
      }),

    state: z
      .string()
      .trim()
      .min(1, { message: 'State/province is required.' })
      .max(ADDRESS_STATE_MAX_LENGTH, {
        message: `State/province must be at most ${ADDRESS_STATE_MAX_LENGTH} characters.`,
      }),

    postalCode: z
      .string()
      .trim()
      .min(1, { message: 'Postal code is required.' })
      .max(ADDRESS_POSTAL_CODE_MAX_LENGTH, {
        message: `Postal code must be at most ${ADDRESS_POSTAL_CODE_MAX_LENGTH} characters.`,
      }),
  }),
});

/**
 * Parsed, validated Step 2 owner details (the schema's OUTPUT type). This shape
 * matches `OwnerDetailsInput` from `@/types` and is what gets dispatched via
 * `SUBMIT_OWNER_DETAILS`.
 */
export type OwnerDetailsFormValues = z.output<typeof ownerDetailsSchema>;

/**
 * The schema's INPUT type — the raw field values React Hook Form holds before
 * the `phone` transform runs. RHF's `useForm` is parameterized with this type
 * so the `zodResolver` (typed input\u2192output under Zod) lines up exactly.
 */
export type OwnerDetailsFormInput = z.input<typeof ownerDetailsSchema>;
