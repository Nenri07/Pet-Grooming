/**
 * Predefined coat condition options for the public booking flow (Requirement
 * 3.2) and the estimate engine (Requirement 5.2).
 *
 * Coat condition is "required, selectable from: smooth, double, wire, curly,
 * long, matted". These values mirror the `CoatCondition` union in `src/types`
 * and the `coatCondition` enum on the Pet Mongoose model, and they are also the
 * keys the estimate engine uses for its coat multipliers.
 *
 * _Requirements: 3.2_
 */
import type { CoatCondition } from '@/types';

/** The six coat conditions, in display order. */
export const COAT_CONDITION_VALUES = [
  'smooth',
  'double',
  'wire',
  'curly',
  'long',
  'matted',
] as const satisfies readonly CoatCondition[];

/** A single option rendered in the coat condition `<select>`. */
export interface CoatConditionOption {
  value: CoatCondition;
  /** Human-friendly, capitalized label. */
  label: string;
}

/** Options for the coat condition `<select>`. */
export const COAT_CONDITION_OPTIONS: readonly CoatConditionOption[] =
  COAT_CONDITION_VALUES.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }));
