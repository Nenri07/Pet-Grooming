'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { BookingState, BookingAction } from '@/hooks/useBookingFlow';
import type { IService } from '@/lib/db/models/service';
import type { PetInfoInput } from '@/types';
import {
  petInfoSchema,
  type PetInfoFormValues,
  type PetInfoFormInput,
  PET_NAME_MAX_LENGTH,
  PET_NOTES_MAX_LENGTH,
} from '@/lib/validators/booking';
import { BREED_OPTIONS, type BreedOption } from '@/config/breeds';
import { TEMPERAMENT_OPTIONS } from '@/config/temperaments';
import { COAT_CONDITION_OPTIONS } from '@/config/coat-conditions';
import { SPECIAL_FLAG_OPTIONS } from '@/config/special-flags';
import { ImageUpload } from '@/components/ui/ImageUpload';

/**
 * Shared props contract for every booking step component.
 *
 * All six step components ({@link StepPetInfo}, StepOwnerDetails, StepEstimate,
 * StepCalendar, StepPayment, StepSuccess) receive the current booking `state`,
 * the reducer `dispatch`, and the groomer's `services`. BookingFlow renders
 * each step uniformly through this contract, so the type is declared here and
 * re-imported by the siblings.
 */
export interface BookingStepProps {
  /** Current booking flow state (captured data + navigation cursor). */
  state: BookingState;
  /** Dispatch for booking flow actions (e.g. SUBMIT_PET_INFO, GO_BACK). */
  dispatch: React.Dispatch<BookingAction>;
  /** The groomer's bookable services, used from the estimate step onward. */
  services: Array<Pick<IService, 'name' | 'basePrice' | 'durationMinutes'>>;
}

/** Groups the breed options by their optgroup label, preserving order. */
function groupBreedOptions(
  options: readonly BreedOption[]
): Array<{ group: BreedOption['group']; items: BreedOption[] }> {
  const groups: Array<{ group: BreedOption['group']; items: BreedOption[] }> = [];
  for (const option of options) {
    let bucket = groups.find((g) => g.group === option.group);
    if (!bucket) {
      bucket = { group: option.group, items: [] };
      groups.push(bucket);
    }
    bucket.items.push(option);
  }
  return groups;
}

/**
 * Maps the previously captured `PetInfoInput` (from booking state) back onto
 * the form's field values, so returning to Step 1 restores prior entries
 * (Requirement 3.6). Optional fields fall back to the empty form values.
 */
function toFormValues(petInfo: PetInfoInput | null): Partial<PetInfoFormInput> {
  if (!petInfo) return {};
  return {
    name: petInfo.name,
    photoUrl: petInfo.photoUrl ?? '',
    breed: petInfo.breed as PetInfoFormInput['breed'],
    weight: petInfo.weight,
    weightUnit: petInfo.weightUnit,
    age: petInfo.age,
    temperament: petInfo.temperament,
    coatCondition: petInfo.coatCondition,
    specialFlags: (petInfo.specialFlags ?? []) as PetInfoFormInput['specialFlags'],
    notes: petInfo.notes ?? '',
  };
}

/**
 * Normalizes validated form values into the `PetInfoInput` shape stored in
 * booking state: empty optional strings become `undefined`, and specialFlags
 * defaults to an empty array.
 */
function toPetInfoInput(values: PetInfoFormValues): PetInfoInput {
  const photoUrl = values.photoUrl?.trim() ? values.photoUrl.trim() : undefined;
  const notes = values.notes?.trim() ? values.notes.trim() : undefined;
  return {
    name: values.name,
    photoUrl,
    breed: values.breed,
    weight: values.weight,
    weightUnit: values.weightUnit,
    age: values.age,
    temperament: values.temperament,
    coatCondition: values.coatCondition,
    specialFlags: values.specialFlags ?? [],
    notes,
  };
}

/**
 * StepPetInfo — Step 1 of the public booking flow: Pet Information.
 *
 * Uses React Hook Form with a Zod resolver over the shared `petInfoSchema`
 * (Requirements 3.2, 21.1). Validation runs `onBlur` and re-validates
 * `onChange`, so a previously invalid field's inline error clears as the user
 * corrects it, while RHF retains all valid field values on a failed submit —
 * inline errors are shown adjacent to each field without clearing valid values
 * (Requirement 3.4).
 *
 * On a valid submit the values are normalized to `PetInfoInput` and dispatched
 * via `SUBMIT_PET_INFO`, which advances the flow to Step 2 (the animated
 * transition itself is handled by BookingFlow, Requirement 3.3). Prior entries
 * are restored from `state.petInfo` on back navigation (Requirement 3.6).
 *
 * Photo upload: the optional pet photo is uploaded directly to Cloudinary via
 * the shared {@link ImageUpload} component, wired through a react-hook-form
 * `Controller` so the returned `secure_url` is stored in the `photoUrl` field.
 * The field stays optional — an empty value produces no validation error.
 *
 * Styling uses DaisyUI form controls with a minimum 44px touch target on every
 * interactive element (Requirement 19.2).
 *
 * _Requirements: 3.2, 3.3, 3.4, 3.6_
 */
export function StepPetInfo({ state, dispatch }: BookingStepProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PetInfoFormInput, unknown, PetInfoFormValues>({
    resolver: zodResolver(petInfoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      name: '',
      photoUrl: '',
      breed: undefined,
      weight: undefined,
      weightUnit: 'lbs',
      age: undefined,
      temperament: undefined,
      coatCondition: undefined,
      specialFlags: [],
      notes: '',
      ...toFormValues(state.petInfo),
    },
  });

  const breedGroups = React.useMemo(() => groupBreedOptions(BREED_OPTIONS), []);
  const notesValue = watch('notes') ?? '';

  const submit = handleSubmit((values) => {
    dispatch({ type: 'SUBMIT_PET_INFO', payload: toPetInfoInput(values) });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Pet information">
      <div>
        <h2 className="text-xl font-semibold text-base-content">Tell us about your pet</h2>
        <p className="text-sm text-base-content/60">Step 1 of 5 — Pet information</p>
      </div>

      {/* Name */}
      <div className="form-control">
        <label className="label" htmlFor="pet-name">
          <span className="label-text">Pet name</span>
        </label>
        <input
          id="pet-name"
          type="text"
          maxLength={PET_NAME_MAX_LENGTH}
          autoComplete="off"
          className={`input input-bordered min-h-[44px] w-full ${
            errors.name ? 'input-error' : ''
          }`}
          aria-invalid={errors.name ? 'true' : 'false'}
          {...register('name')}
        />
        {errors.name && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.name.message}
          </p>
        )}
      </div>

      {/* Pet photo (optional) — uploaded directly to Cloudinary. */}
      <div className="form-control">
        <label className="label" htmlFor="pet-photo-upload">
          <span className="label-text">Pet photo</span>
          <span className="label-text-alt text-base-content/50">Optional</span>
        </label>
        <Controller
          control={control}
          name="photoUrl"
          render={({ field }) => (
            <ImageUpload
              id="pet-photo-upload"
              context="bookingPetPhoto"
              label="Upload photo"
              value={field.value ?? ''}
              onChange={(url) => field.onChange(url)}
              disabled={isSubmitting}
            />
          )}
        />
        {errors.photoUrl && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.photoUrl.message}
          </p>
        )}
      </div>

      {/* Breed */}
      <div className="form-control">
        <label className="label" htmlFor="pet-breed">
          <span className="label-text">Breed</span>
        </label>
        <select
          id="pet-breed"
          className={`select select-bordered min-h-[44px] w-full ${
            errors.breed ? 'select-error' : ''
          }`}
          aria-invalid={errors.breed ? 'true' : 'false'}
          defaultValue=""
          {...register('breed')}
        >
          <option value="" disabled>
            Select a breed
          </option>
          {breedGroups.map((bucket) => (
            <optgroup key={bucket.group} label={bucket.group}>
              {bucket.items.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {errors.breed && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.breed.message}
          </p>
        )}
      </div>

      {/* Weight + unit */}
      <div className="form-control">
        <label className="label" htmlFor="pet-weight">
          <span className="label-text">Weight</span>
        </label>
        <div className="flex gap-2">
          <input
            id="pet-weight"
            type="number"
            inputMode="decimal"
            min={1}
            max={200}
            step="any"
            className={`input input-bordered min-h-[44px] w-full ${
              errors.weight ? 'input-error' : ''
            }`}
            aria-invalid={errors.weight ? 'true' : 'false'}
            {...register('weight')}
          />
          <select
            aria-label="Weight unit"
            className={`select select-bordered min-h-[44px] ${
              errors.weightUnit ? 'select-error' : ''
            }`}
            aria-invalid={errors.weightUnit ? 'true' : 'false'}
            {...register('weightUnit')}
          >
            <option value="lbs">lbs</option>
            <option value="kg">kg</option>
          </select>
        </div>
        {errors.weight ? (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.weight.message}
          </p>
        ) : (
          errors.weightUnit && (
            <p className="mt-1 text-sm text-error" role="alert">
              {errors.weightUnit.message}
            </p>
          )
        )}
      </div>

      {/* Age */}
      <div className="form-control">
        <label className="label" htmlFor="pet-age">
          <span className="label-text">Age (years)</span>
        </label>
        <input
          id="pet-age"
          type="number"
          inputMode="numeric"
          min={0}
          max={30}
          step="any"
          className={`input input-bordered min-h-[44px] w-full ${
            errors.age ? 'input-error' : ''
          }`}
          aria-invalid={errors.age ? 'true' : 'false'}
          {...register('age')}
        />
        {errors.age && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.age.message}
          </p>
        )}
      </div>

      {/* Temperament */}
      <div className="form-control">
        <label className="label" htmlFor="pet-temperament">
          <span className="label-text">Temperament</span>
        </label>
        <select
          id="pet-temperament"
          className={`select select-bordered min-h-[44px] w-full ${
            errors.temperament ? 'select-error' : ''
          }`}
          aria-invalid={errors.temperament ? 'true' : 'false'}
          defaultValue=""
          {...register('temperament')}
        >
          <option value="" disabled>
            Select a temperament
          </option>
          {TEMPERAMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {errors.temperament && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.temperament.message}
          </p>
        )}
      </div>

      {/* Coat condition */}
      <div className="form-control">
        <label className="label" htmlFor="pet-coat">
          <span className="label-text">Coat condition</span>
        </label>
        <select
          id="pet-coat"
          className={`select select-bordered min-h-[44px] w-full ${
            errors.coatCondition ? 'select-error' : ''
          }`}
          aria-invalid={errors.coatCondition ? 'true' : 'false'}
          defaultValue=""
          {...register('coatCondition')}
        >
          <option value="" disabled>
            Select a coat condition
          </option>
          {COAT_CONDITION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {errors.coatCondition && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.coatCondition.message}
          </p>
        )}
      </div>

      {/* Special flags (multi-select checkboxes) */}
      <div className="form-control">
        <span className="label-text mb-1">Special flags</span>
        <Controller
          control={control}
          name="specialFlags"
          render={({ field }) => {
            const selected = field.value ?? [];
            const toggle = (value: string, checked: boolean) => {
              const next = checked
                ? [...selected, value]
                : selected.filter((v) => v !== value);
              field.onChange(next);
            };
            return (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SPECIAL_FLAG_OPTIONS.map((option) => {
                  const inputId = `flag-${option.value}`;
                  return (
                    <label
                      key={option.value}
                      htmlFor={inputId}
                      className="label min-h-[44px] cursor-pointer justify-start gap-3"
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        className="checkbox checkbox-primary"
                        value={option.value}
                        checked={selected.includes(option.value)}
                        onChange={(e) => toggle(option.value, e.target.checked)}
                        onBlur={field.onBlur}
                      />
                      <span className="label-text">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            );
          }}
        />
        {errors.specialFlags && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.specialFlags.message as string}
          </p>
        )}
      </div>

      {/* Notes */}
      <div className="form-control">
        <label className="label" htmlFor="pet-notes">
          <span className="label-text">Notes</span>
          <span className="label-text-alt text-base-content/50">
            {notesValue.length}/{PET_NOTES_MAX_LENGTH}
          </span>
        </label>
        <textarea
          id="pet-notes"
          rows={3}
          maxLength={PET_NOTES_MAX_LENGTH}
          className={`textarea textarea-bordered w-full ${
            errors.notes ? 'textarea-error' : ''
          }`}
          aria-invalid={errors.notes ? 'true' : 'false'}
          {...register('notes')}
        />
        {errors.notes && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.notes.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn btn-primary min-h-[44px] w-full"
      >
        {isSubmitting ? (
          <span className="loading loading-spinner loading-sm" aria-hidden="true" />
        ) : (
          'Continue'
        )}
      </button>
    </form>
  );
}

export default StepPetInfo;
