/**
 * Predefined temperament options for the public booking flow (Requirement 3.2).
 *
 * Temperament is "required, selectable from predefined options such as calm,
 * nervous, aggressive, friendly". These values mirror the `Temperament` union
 * in `src/types` and the `temperament` enum on the Pet Mongoose model, so the
 * booking form, the schema, and the database all agree on the same four values.
 *
 * _Requirements: 3.2_
 */
import type { Temperament } from '@/types';

/** The four temperament values, in display order. */
export const TEMPERAMENT_VALUES = [
  'calm',
  'nervous',
  'aggressive',
  'friendly',
] as const satisfies readonly Temperament[];

/** A single option rendered in the temperament `<select>`. */
export interface TemperamentOption {
  value: Temperament;
  /** Human-friendly, capitalized label. */
  label: string;
}

/** Options for the temperament `<select>`. */
export const TEMPERAMENT_OPTIONS: readonly TemperamentOption[] =
  TEMPERAMENT_VALUES.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }));
