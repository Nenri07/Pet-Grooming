'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { BookingStepProps } from './StepPetInfo';
import type { OwnerDetailsInput } from '@/types';
import {
  ownerDetailsSchema,
  type OwnerDetailsFormValues,
  type OwnerDetailsFormInput,
  OWNER_NAME_MAX_LENGTH,
  OWNER_EMAIL_MAX_LENGTH,
  ADDRESS_STREET_MAX_LENGTH,
  ADDRESS_CITY_MAX_LENGTH,
  ADDRESS_STATE_MAX_LENGTH,
  ADDRESS_POSTAL_CODE_MAX_LENGTH,
} from '@/lib/validators/booking';

/**
 * Maps the previously captured `OwnerDetailsInput` (from booking state) back
 * onto the form's field values, so returning to Step 2 restores prior entries
 * (Requirement 4.5). When no owner details have been captured yet the empty
 * form defaults are used.
 */
function toFormValues(
  owner: OwnerDetailsInput | null
): Partial<OwnerDetailsFormInput> {
  if (!owner) return {};
  return {
    name: owner.name,
    email: owner.email,
    phone: owner.phone,
    address: {
      street: owner.address.street,
      city: owner.address.city,
      state: owner.address.state,
      postalCode: owner.address.postalCode,
    },
  };
}

/**
 * StepOwnerDetails — Step 2 of the public booking flow: Owner details and
 * service address.
 *
 * Uses React Hook Form with a Zod resolver over the shared `ownerDetailsSchema`
 * (Requirements 4.2, 21.1). Validation runs `onBlur` and re-validates
 * `onChange`, so a previously invalid field's inline error clears as the user
 * corrects it, while RHF retains all valid field values on a failed submit —
 * inline errors are shown adjacent to each field indicating the specific
 * failure without clearing valid values (Requirement 4.4).
 *
 * On a valid submit the values (already shaped as `OwnerDetailsInput`) are
 * dispatched via `SUBMIT_OWNER_DETAILS`, which advances the flow to Step 3 (the
 * animated transition itself is handled by BookingFlow, Requirement 4.3). A
 * Back button dispatches `GO_BACK`. Prior entries are restored from
 * `state.ownerDetails` on back navigation (Requirement 4.5).
 *
 * Styling uses DaisyUI form controls with a minimum 44px touch target on every
 * interactive element (Requirement 19.2).
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
 */
export function StepOwnerDetails({ state, dispatch }: BookingStepProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OwnerDetailsFormInput, unknown, OwnerDetailsFormValues>({
    resolver: zodResolver(ownerDetailsSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      address: {
        street: '',
        city: '',
        state: '',
        postalCode: '',
      },
      ...toFormValues(state.ownerDetails),
    },
  });

  // SMS consent (Master Spec §12.3): UNCHECKED by default. Restored from state
  // on back-navigation so the choice is lossless.
  const [smsConsent, setSmsConsent] = React.useState<boolean>(state.smsConsent);

  const submit = handleSubmit((values) => {
    // `values` already conforms to OwnerDetailsInput (nested address, phone
    // normalized by the schema transform).
    dispatch({ type: 'SUBMIT_OWNER_DETAILS', payload: values, smsConsent });
  });

  const addressErrors = errors.address;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
      aria-label="Owner details and service address"
    >
      <div>
        <h2 className="text-xl font-semibold text-base-content">Your details</h2>
        <p className="text-sm text-base-content/60">
          Step 2 of 5 — Owner details &amp; service address
        </p>
      </div>

      {/* Full name */}
      <div className="form-control">
        <label className="label" htmlFor="owner-name">
          <span className="label-text">Full name</span>
        </label>
        <input
          id="owner-name"
          type="text"
          maxLength={OWNER_NAME_MAX_LENGTH}
          autoComplete="name"
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

      {/* Email */}
      <div className="form-control">
        <label className="label" htmlFor="owner-email">
          <span className="label-text">Email</span>
        </label>
        <input
          id="owner-email"
          type="email"
          inputMode="email"
          maxLength={OWNER_EMAIL_MAX_LENGTH}
          autoComplete="email"
          className={`input input-bordered min-h-[44px] w-full ${
            errors.email ? 'input-error' : ''
          }`}
          aria-invalid={errors.email ? 'true' : 'false'}
          {...register('email')}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* Phone */}
      <div className="form-control">
        <label className="label" htmlFor="owner-phone">
          <span className="label-text">Phone number</span>
        </label>
        <input
          id="owner-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+1 555 123 4567"
          className={`input input-bordered min-h-[44px] w-full ${
            errors.phone ? 'input-error' : ''
          }`}
          aria-invalid={errors.phone ? 'true' : 'false'}
          {...register('phone')}
        />
        {errors.phone && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.phone.message}
          </p>
        )}
      </div>

      <div className="divider my-1 text-sm text-base-content/50">
        Service address
      </div>

      {/* Street */}
      <div className="form-control">
        <label className="label" htmlFor="owner-street">
          <span className="label-text">Street address</span>
        </label>
        <input
          id="owner-street"
          type="text"
          maxLength={ADDRESS_STREET_MAX_LENGTH}
          autoComplete="street-address"
          className={`input input-bordered min-h-[44px] w-full ${
            addressErrors?.street ? 'input-error' : ''
          }`}
          aria-invalid={addressErrors?.street ? 'true' : 'false'}
          {...register('address.street')}
        />
        {addressErrors?.street && (
          <p className="mt-1 text-sm text-error" role="alert">
            {addressErrors.street.message}
          </p>
        )}
      </div>

      {/* City */}
      <div className="form-control">
        <label className="label" htmlFor="owner-city">
          <span className="label-text">City</span>
        </label>
        <input
          id="owner-city"
          type="text"
          maxLength={ADDRESS_CITY_MAX_LENGTH}
          autoComplete="address-level2"
          className={`input input-bordered min-h-[44px] w-full ${
            addressErrors?.city ? 'input-error' : ''
          }`}
          aria-invalid={addressErrors?.city ? 'true' : 'false'}
          {...register('address.city')}
        />
        {addressErrors?.city && (
          <p className="mt-1 text-sm text-error" role="alert">
            {addressErrors.city.message}
          </p>
        )}
      </div>

      {/* State/province + postal code */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="form-control">
          <label className="label" htmlFor="owner-state">
            <span className="label-text">State/province</span>
          </label>
          <input
            id="owner-state"
            type="text"
            maxLength={ADDRESS_STATE_MAX_LENGTH}
            autoComplete="address-level1"
            className={`input input-bordered min-h-[44px] w-full ${
              addressErrors?.state ? 'input-error' : ''
            }`}
            aria-invalid={addressErrors?.state ? 'true' : 'false'}
            {...register('address.state')}
          />
          {addressErrors?.state && (
            <p className="mt-1 text-sm text-error" role="alert">
              {addressErrors.state.message}
            </p>
          )}
        </div>

        <div className="form-control">
          <label className="label" htmlFor="owner-postal">
            <span className="label-text">Postal code</span>
          </label>
          <input
            id="owner-postal"
            type="text"
            maxLength={ADDRESS_POSTAL_CODE_MAX_LENGTH}
            autoComplete="postal-code"
            className={`input input-bordered min-h-[44px] w-full ${
              addressErrors?.postalCode ? 'input-error' : ''
            }`}
            aria-invalid={addressErrors?.postalCode ? 'true' : 'false'}
            {...register('address.postalCode')}
          />
          {addressErrors?.postalCode && (
            <p className="mt-1 text-sm text-error" role="alert">
              {addressErrors.postalCode.message}
            </p>
          )}
        </div>
      </div>

      {/* SMS consent — unchecked by default (Master Spec §12.3). */}
      <div className="form-control mt-2">
        <label className="flex cursor-pointer items-start gap-3" htmlFor="owner-sms-consent">
          <input
            id="owner-sms-consent"
            type="checkbox"
            className="checkbox checkbox-primary mt-0.5 min-h-[24px] min-w-[24px]"
            checked={smsConsent}
            onChange={(e) => setSmsConsent(e.target.checked)}
          />
          <span className="label-text text-sm text-base-content/70">
            Text me appointment updates. Msg &amp; data rates may apply. Reply STOP to opt out.
          </span>
        </label>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="btn btn-ghost min-h-[44px] flex-1"
          onClick={() => dispatch({ type: 'GO_BACK' })}
        >
          Back
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn btn-primary min-h-[44px] flex-1"
        >
          {isSubmitting ? (
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </form>
  );
}

export default StepOwnerDetails;
