/**
 * Zod schema for the onboarding wizard's business-information step (step 1).
 *
 * This mirrors the relevant fields of `settingsSchema` plus the groomer slug,
 * so the wizard can validate business info + booking link together in one form
 * with inline errors (Requirement 2.6). It is consumed on the client via React
 * Hook Form's `zodResolver`; the underlying server actions
 * (`updateBusinessSettings`, `updateGroomerSlug`) re-validate everything, so a
 * bypassed or malformed client submission is still rejected (Requirement 21.1).
 *
 * Field rules mirror Requirement 15.1 / 15.5 and the GroomerProfile model:
 *  - businessName: required, 1..100 characters
 *  - phone: optional, max 15 characters
 *  - businessEmail: optional, valid email, max 254 characters
 *  - groomerSlug: required, lowercase letters/numbers/hyphens, 3..40 characters
 *
 * _Requirements: 2.1, 2.6, 15.1, 15.5_
 */
import { z } from 'zod';
import { SLUG_PATTERN } from '@/lib/validators/slug';

/** Maximum length of the business name (Requirement 15.1). */
export const ONBOARDING_BUSINESS_NAME_MAX_LENGTH = 100;
/** Maximum length of the business phone number (mirrors the model). */
export const ONBOARDING_PHONE_MAX_LENGTH = 15;
/** Maximum length of the business email (mirrors the model). */
export const ONBOARDING_EMAIL_MAX_LENGTH = 254;

/**
 * Business-info step schema.
 *
 * `phone` and `businessEmail` are optional (a blank string is treated as "not
 * provided"). `groomerSlug` is required and constrained to the canonical slug
 * format; uniqueness is enforced server-side by `updateGroomerSlug`
 * (Requirement 15.6).
 */
export const businessInfoSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(1, { message: 'Business name is required.' })
    .max(ONBOARDING_BUSINESS_NAME_MAX_LENGTH, {
      message: `Business name must be at most ${ONBOARDING_BUSINESS_NAME_MAX_LENGTH} characters.`,
    }),

  phone: z
    .string()
    .trim()
    .max(ONBOARDING_PHONE_MAX_LENGTH, {
      message: `Phone number must be at most ${ONBOARDING_PHONE_MAX_LENGTH} characters.`,
    })
    .optional()
    .or(z.literal('')),

  businessEmail: z
    .string()
    .trim()
    .max(ONBOARDING_EMAIL_MAX_LENGTH, {
      message: `Email must be at most ${ONBOARDING_EMAIL_MAX_LENGTH} characters.`,
    })
    .email({ message: 'Enter a valid email address.' })
    .optional()
    .or(z.literal('')),

  groomerSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_PATTERN, {
      message:
        'Use 3–40 characters: lowercase letters, numbers, and hyphens only.',
    }),
});

/** Input type held by React Hook Form for the business-info step. */
export type BusinessInfoInput = z.input<typeof businessInfoSchema>;

/** Parsed, validated business-info values. */
export type BusinessInfoValues = z.output<typeof businessInfoSchema>;
