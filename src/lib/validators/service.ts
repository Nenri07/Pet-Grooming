/**
 * Zod schema and pure helpers for creating / editing a Service in the Groomer
 * Portal.
 *
 * `serviceSchema` is the single source of truth for the shape and rules of the
 * service create/edit form (Requirement 13.2). It is consumed on the client via
 * React Hook Form's `zodResolver` and re-validated server-side in the service
 * server actions so a bypassed or malformed client submission is still rejected
 * (Requirement 21.1).
 *
 * Field rules mirror Requirement 13.2 and the Service Mongoose model:
 *  - name: required, 1..100 characters
 *  - description: optional, max 500 characters
 *  - basePrice: required numeric, 0.01..9999.99 (coerced from string inputs)
 *  - durationMinutes: required integer, 15..480 (coerced from string inputs)
 *
 * _Requirements: 13.1, 13.2, 21.1_
 */
import { z } from 'zod';

/** Maximum length of the service name (Requirement 13.2). */
export const SERVICE_NAME_MAX_LENGTH = 100;
/** Maximum length of the optional description (Requirement 13.2). */
export const SERVICE_DESCRIPTION_MAX_LENGTH = 500;
/** Minimum / maximum base price, in the local currency (Requirement 13.2). */
export const SERVICE_PRICE_MIN = 0.01;
export const SERVICE_PRICE_MAX = 9999.99;
/** Minimum / maximum estimated duration in minutes (Requirement 13.2). */
export const SERVICE_DURATION_MIN = 15;
export const SERVICE_DURATION_MAX = 480;

/**
 * Service create/edit schema.
 *
 * Numeric fields use `z.coerce.number()` so values arriving as strings from an
 * HTML `<input type="number">` are coerced before range checks run, while the
 * inferred OUTPUT type remains `number`. `description` is normalized: an empty
 * string is treated as "no description" so the DB stores `undefined` rather
 * than an empty string.
 */
export const serviceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Service name is required.' })
    .max(SERVICE_NAME_MAX_LENGTH, {
      message: `Service name must be at most ${SERVICE_NAME_MAX_LENGTH} characters.`,
    }),

  description: z
    .string()
    .trim()
    .max(SERVICE_DESCRIPTION_MAX_LENGTH, {
      message: `Description must be at most ${SERVICE_DESCRIPTION_MAX_LENGTH} characters.`,
    })
    .optional()
    .or(z.literal('')),

  basePrice: z.coerce
    .number({ message: 'Enter a base price.' })
    .min(SERVICE_PRICE_MIN, {
      message: `Base price must be at least ${SERVICE_PRICE_MIN.toFixed(2)}.`,
    })
    .max(SERVICE_PRICE_MAX, {
      message: `Base price must be at most ${SERVICE_PRICE_MAX.toFixed(2)}.`,
    }),

  durationMinutes: z.coerce
    .number({ message: 'Enter a duration.' })
    .int({ message: 'Duration must be a whole number of minutes.' })
    .min(SERVICE_DURATION_MIN, {
      message: `Duration must be at least ${SERVICE_DURATION_MIN} minutes.`,
    })
    .max(SERVICE_DURATION_MAX, {
      message: `Duration must be at most ${SERVICE_DURATION_MAX} minutes.`,
    }),
});

/**
 * Parsed, validated service values (the schema's OUTPUT type). Numeric fields
 * are `number` here because `z.coerce.number()` has run.
 */
export type ServiceFormValues = z.output<typeof serviceSchema>;

/**
 * The schema's INPUT type — the raw field values React Hook Form holds before
 * Zod coercion. Because `basePrice`/`durationMinutes` use `z.coerce.number()`,
 * their input side accepts what an HTML input provides; RHF's `useForm` is
 * parameterized with this type so the `zodResolver` (typed input→output under
 * Zod) lines up.
 */
export type ServiceFormInput = z.input<typeof serviceSchema>;
