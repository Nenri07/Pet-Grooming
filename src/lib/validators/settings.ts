/**
 * Zod schema and exported types for the Groomer Portal business-settings form.
 *
 * `settingsSchema` is the single source of truth for the shape and rules of the
 * business profile form (Requirement 15.1). It is consumed on the client via
 * React Hook Form's `zodResolver` and re-validated server-side in
 * `src/actions/settings.ts`, so a bypassed or malformed client submission is
 * still rejected (Requirement 21.1).
 *
 * The groomer slug is intentionally NOT part of this schema — it is validated
 * and persisted separately (with a uniqueness check) via `updateGroomerSlug`
 * and the pure `isValidSlugFormat` helper in `src/lib/validators/slug.ts`
 * (Requirements 15.5, 15.6).
 *
 * Field rules mirror Requirement 15.1 and the GroomerProfile Mongoose model:
 *  - businessName: required, 1..100 characters
 *  - phone: optional, max 15 characters
 *  - businessEmail: optional, valid email, max 254 characters
 *  - depositAmount: required numeric, 0..500 (coerced from string inputs)
 *  - estimateRules: array of rules, each with an optional coat condition, an
 *    optional weight range, a priceAdjustmentPercent integer in [-50, 50], and
 *    an optional note up to 500 characters
 *  - logoUrl: optional string (a Cloudinary secure_url produced by ImageUpload)
 *
 * _Requirements: 15.1, 21.1_
 */
import { z } from 'zod';
import type { CoatCondition } from '@/types';

/** Maximum length of the business name (Requirement 15.1). */
export const BUSINESS_NAME_MAX_LENGTH = 100;
/** Maximum length of the business phone number (mirrors the model). */
export const PHONE_MAX_LENGTH = 15;
/** Maximum length of the business email (mirrors the model). */
export const BUSINESS_EMAIL_MAX_LENGTH = 254;
/** Minimum / maximum deposit amount, in the local currency (Requirement 15.1). */
export const DEPOSIT_MIN = 0;
export const DEPOSIT_MAX = 500;
/** Price adjustment percentage bounds per estimate rule (Requirement 15.1). */
export const PRICE_ADJUSTMENT_MIN = -50;
export const PRICE_ADJUSTMENT_MAX = 50;
/** Maximum length of an estimate rule note (Requirement 15.1). */
export const ESTIMATE_RULE_NOTE_MAX_LENGTH = 500;

/** The coat-condition values an estimate rule may target (matches the model). */
export const COAT_CONDITIONS = [
  'smooth',
  'double',
  'wire',
  'curly',
  'long',
  'matted',
] as const satisfies readonly CoatCondition[];

/**
 * A single estimate rule.
 *
 * `coatCondition` and the two weight bounds are optional so a groomer can write
 * a rule that keys off coat, weight, both, or neither. `priceAdjustmentPercent`
 * is coerced (HTML number inputs arrive as strings), constrained to an integer
 * in [-50, 50]. `note` is normalized: an empty string is treated as "no note".
 */
export const estimateRuleSchema = z
  .object({
    coatCondition: z
      .enum(COAT_CONDITIONS)
      .optional()
      // A blank <select> value ("") means "no coat condition".
      .or(z.literal('')),

    weightMin: z.coerce
      .number({ message: 'Enter a number.' })
      .min(0, { message: 'Minimum weight cannot be negative.' })
      .optional()
      .or(z.literal('')),

    weightMax: z.coerce
      .number({ message: 'Enter a number.' })
      .min(0, { message: 'Maximum weight cannot be negative.' })
      .optional()
      .or(z.literal('')),

    priceAdjustmentPercent: z.coerce
      .number({ message: 'Enter an adjustment percentage.' })
      .int({ message: 'Adjustment must be a whole percentage.' })
      .min(PRICE_ADJUSTMENT_MIN, {
        message: `Adjustment must be at least ${PRICE_ADJUSTMENT_MIN}%.`,
      })
      .max(PRICE_ADJUSTMENT_MAX, {
        message: `Adjustment must be at most ${PRICE_ADJUSTMENT_MAX}%.`,
      }),

    note: z
      .string()
      .trim()
      .max(ESTIMATE_RULE_NOTE_MAX_LENGTH, {
        message: `Note must be at most ${ESTIMATE_RULE_NOTE_MAX_LENGTH} characters.`,
      })
      .optional()
      .or(z.literal('')),
  })
  .refine(
    (rule) => {
      // When both weight bounds are provided, max must be >= min.
      const min = rule.weightMin;
      const max = rule.weightMax;
      if (typeof min === 'number' && typeof max === 'number') {
        return max >= min;
      }
      return true;
    },
    {
      message: 'Maximum weight must be greater than or equal to minimum weight.',
      path: ['weightMax'],
    }
  );

/**
 * Business settings schema.
 *
 * Numeric fields use `z.coerce.number()` so values arriving as strings from an
 * HTML `<input type="number">` are coerced before range checks run, while the
 * inferred OUTPUT type remains `number`.
 */
export const settingsSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(1, { message: 'Business name is required.' })
    .max(BUSINESS_NAME_MAX_LENGTH, {
      message: `Business name must be at most ${BUSINESS_NAME_MAX_LENGTH} characters.`,
    }),

  phone: z
    .string()
    .trim()
    .max(PHONE_MAX_LENGTH, {
      message: `Phone number must be at most ${PHONE_MAX_LENGTH} characters.`,
    })
    .optional()
    .or(z.literal('')),

  businessEmail: z
    .string()
    .trim()
    .max(BUSINESS_EMAIL_MAX_LENGTH, {
      message: `Email must be at most ${BUSINESS_EMAIL_MAX_LENGTH} characters.`,
    })
    .email({ message: 'Enter a valid email address.' })
    .optional()
    .or(z.literal('')),

  depositAmount: z.coerce
    .number({ message: 'Enter a deposit amount.' })
    .min(DEPOSIT_MIN, {
      message: `Deposit must be at least ${DEPOSIT_MIN.toFixed(2)}.`,
    })
    .max(DEPOSIT_MAX, {
      message: `Deposit must be at most ${DEPOSIT_MAX.toFixed(2)}.`,
    }),

  estimateRules: z.array(estimateRuleSchema),

  logoUrl: z.string().trim().optional().or(z.literal('')),
});

/**
 * The schema's INPUT type — the raw field values React Hook Form holds before
 * Zod coercion. Because numeric fields use `z.coerce.number()`, their input
 * side accepts what an HTML input provides; RHF's `useForm` is parameterized
 * with this type so the `zodResolver` (typed input→output under Zod) lines up.
 */
export type ServiceSettingsInput = z.input<typeof settingsSchema>;

/**
 * Parsed, validated settings values (the schema's OUTPUT type). Numeric fields
 * are `number` here because `z.coerce.number()` has run.
 */
export type ServiceSettingsValues = z.output<typeof settingsSchema>;
