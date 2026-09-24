/**
 * Zod schema for editing a Pet profile in the Groomer Portal.
 *
 * `petEditSchema` is the single source of truth for the shape and rules of the
 * pet edit form (Requirement 11.5 / 11.6). It is intended to be consumed on the
 * client via React Hook Form's `zodResolver` and re-validated server-side in
 * `updatePet` so a bypassed or malformed client submission is still rejected
 * (Requirement 21.1). When any required field is invalid, `updatePet` blocks
 * persistence and returns field errors instead of saving (Requirement 11.5).
 *
 * Field rules mirror the editable Pet fields from Requirement 11.5 and the Pet
 * Mongoose model:
 *  - name: required, 1..50 characters
 *  - breed: required string, max 100 characters
 *  - weight: required numeric, 1..200 (coerced from string inputs)
 *  - weightUnit: 'lbs' | 'kg'
 *  - age: required numeric, 0..30 (coerced from string inputs)
 *  - temperament: required enum (calm | nervous | aggressive | friendly)
 *  - coatCondition: required enum (smooth | double | wire | curly | long |
 *    matted)
 *  - specialFlags: optional string[]
 *  - notes: optional, max 500 characters
 *
 * _Requirements: 11.1, 11.5, 11.6, 21.1_
 */
import { z } from 'zod';
import { TEMPERAMENT_VALUES } from '@/config/temperaments';
import { COAT_CONDITION_VALUES } from '@/config/coat-conditions';

/** Maximum length of the pet name (Requirement 11.1 / 3.2). */
export const PET_NAME_MAX_LENGTH = 50;
/** Maximum length of the breed free-text field. */
export const PET_BREED_MAX_LENGTH = 100;
/** Minimum / maximum pet weight, unit-agnostic. */
export const PET_WEIGHT_MIN = 1;
export const PET_WEIGHT_MAX = 200;
/** Minimum / maximum pet age in years. */
export const PET_AGE_MIN = 0;
export const PET_AGE_MAX = 30;
/** Maximum length of the free-text notes field. */
export const PET_NOTES_MAX_LENGTH = 500;

/**
 * Pet edit schema.
 *
 * Numeric fields use `z.coerce.number()` so values arriving as strings from an
 * HTML `<input type="number">` are coerced before range checks run, while the
 * inferred OUTPUT type remains `number`.
 */
export const petEditSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Pet name is required.' })
    .max(PET_NAME_MAX_LENGTH, {
      message: `Pet name must be at most ${PET_NAME_MAX_LENGTH} characters.`,
    }),

  breed: z
    .string()
    .trim()
    .min(1, { message: 'Breed is required.' })
    .max(PET_BREED_MAX_LENGTH, {
      message: `Breed must be at most ${PET_BREED_MAX_LENGTH} characters.`,
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

  specialFlags: z.array(z.string()).optional(),

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
 * Parsed, validated pet edit values (the schema's OUTPUT type). Numeric fields
 * are `number` here because `z.coerce.number()` has run.
 */
export type PetEditFormValues = z.output<typeof petEditSchema>;

/**
 * The schema's INPUT type — the raw field values React Hook Form holds before
 * Zod coercion. Because `weight`/`age` use `z.coerce.number()`, their input
 * side accepts what an HTML input provides; RHF's `useForm` is parameterized
 * with this type so the `zodResolver` (typed input→output under Zod) lines up.
 */
export type PetEditFormInput = z.input<typeof petEditSchema>;
