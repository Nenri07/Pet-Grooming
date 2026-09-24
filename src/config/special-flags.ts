/**
 * Predefined special-flag options for the public booking flow (Requirement
 * 3.2).
 *
 * Special flags are "optional, multi-select from predefined options". They
 * capture handling considerations the groomer should know before the
 * appointment. The booking form renders these as a checkbox group, and the Zod
 * `petInfoSchema` validates that every submitted flag is one of these values.
 *
 * _Requirements: 3.2_
 */

/** The predefined special-flag values a Client may multi-select. */
export const SPECIAL_FLAG_VALUES = [
  'senior',
  'medical-condition',
  'anxious',
  'bites-risk',
  'not-neutered',
  'flea-treatment-needed',
] as const;

/** A special-flag value known to the booking flow. */
export type SpecialFlag = (typeof SPECIAL_FLAG_VALUES)[number];

/** A single option rendered in the special-flags checkbox group. */
export interface SpecialFlagOption {
  value: SpecialFlag;
  /** Human-friendly label. */
  label: string;
}

/** Options for the special-flags checkbox group. */
export const SPECIAL_FLAG_OPTIONS: readonly SpecialFlagOption[] = [
  { value: 'senior', label: 'Senior' },
  { value: 'medical-condition', label: 'Medical condition' },
  { value: 'anxious', label: 'Anxious' },
  { value: 'bites-risk', label: 'Bite risk' },
  { value: 'not-neutered', label: 'Not neutered / spayed' },
  { value: 'flea-treatment-needed', label: 'Flea treatment needed' },
];

/** Returns true if `value` is a recognized special flag. */
export function isValidSpecialFlag(value: string): value is SpecialFlag {
  return (SPECIAL_FLAG_VALUES as readonly string[]).includes(value);
}
