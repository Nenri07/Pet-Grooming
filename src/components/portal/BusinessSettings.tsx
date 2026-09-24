'use client';

import * as React from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { ImageUpload } from '@/components/ui/ImageUpload';
import {
  updateBusinessSettings,
  updateGroomerSlug,
  type BusinessSettingsData,
} from '@/actions/settings';
import {
  settingsSchema,
  type ServiceSettingsInput,
  type ServiceSettingsValues,
  BUSINESS_NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  BUSINESS_EMAIL_MAX_LENGTH,
  DEPOSIT_MIN,
  DEPOSIT_MAX,
  PRICE_ADJUSTMENT_MIN,
  PRICE_ADJUSTMENT_MAX,
  ESTIMATE_RULE_NOTE_MAX_LENGTH,
  COAT_CONDITIONS,
} from '@/lib/validators/settings';

/**
 * BusinessSettings — client component for the Groomer Portal settings page.
 *
 * Two independent sections:
 *
 *  1. Business profile form (React Hook Form + `zodResolver(settingsSchema)`):
 *     business name, phone, email, deposit amount, a repeatable list of
 *     estimate rules (coat condition, min/max weight, adjustment %, note), and
 *     a logo upload via the shared `<ImageUpload context="groomerLogo">`
 *     controlled through RHF `Controller`. Inline field errors, success toasts,
 *     and server-side field errors surfaced inline (Requirements 15.1, 15.2,
 *     15.3, 21.1).
 *
 *  2. Booking-link (slug) section — a separate field + save button calling
 *     `updateGroomerSlug`, which validates the slug format (Requirement 15.5)
 *     and rejects a slug already used by another groomer with an inline
 *     availability error (Requirement 15.6).
 *
 * DaisyUI Card styling, 44px minimum touch targets throughout.
 *
 * _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 21.1_
 */

interface BusinessSettingsProps {
  /** The groomer's settings rendered on initial load. */
  initialSettings: BusinessSettingsData;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Human-friendly labels for coat conditions. */
const COAT_LABELS: Record<(typeof COAT_CONDITIONS)[number], string> = {
  smooth: 'Smooth',
  double: 'Double',
  wire: 'Wire',
  curly: 'Curly',
  long: 'Long',
  matted: 'Matted',
};

/** Build the RHF default values from the loaded settings. */
function toFormValues(settings: BusinessSettingsData): ServiceSettingsInput {
  return {
    businessName: settings.businessName,
    phone: settings.phone,
    businessEmail: settings.businessEmail,
    depositAmount: settings.depositAmount,
    estimateRules: settings.estimateRules.map((rule) => ({
      coatCondition: rule.coatCondition ?? '',
      weightMin: rule.weightMin ?? ('' as unknown as number),
      weightMax: rule.weightMax ?? ('' as unknown as number),
      priceAdjustmentPercent: rule.priceAdjustmentPercent,
      note: rule.note ?? '',
    })),
    logoUrl: settings.logoUrl,
  };
}

/** An empty estimate rule row for the "Add rule" action. */
const EMPTY_RULE: ServiceSettingsInput['estimateRules'][number] = {
  coatCondition: '',
  weightMin: '' as unknown as number,
  weightMax: '' as unknown as number,
  priceAdjustmentPercent: 0,
  note: '',
};

// ---------------------------------------------------------------------------
// Business profile form
// ---------------------------------------------------------------------------

function BusinessProfileForm({ initialSettings }: BusinessSettingsProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ServiceSettingsInput, unknown, ServiceSettingsValues>({
    resolver: zodResolver(settingsSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: toFormValues(initialSettings),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'estimateRules',
  });

  const businessNameValue = watch('businessName') ?? '';

  const submit = handleSubmit(async (values) => {
    const result = await updateBusinessSettings(values);

    if (result.ok) {
      toast.success('Business settings saved.');
      return;
    }

    // Surface server-side field errors inline without clearing entered data
    // (Requirement 21.1). Fall back to a persistent error toast otherwise.
    if (result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (messages && messages.length > 0) {
          setError(field as keyof ServiceSettingsInput, {
            type: 'server',
            message: messages[0],
          });
        }
      }
      return;
    }

    toast.error(result.error ?? "We couldn't save your settings. Please try again.", {
      duration: Infinity,
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business profile</CardTitle>
        <CardDescription>
          Your brand, contact details, deposit, and estimate rules shown to clients.
        </CardDescription>
      </CardHeader>

      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Business settings">
        {/* Logo */}
        <div className="form-control">
          <label className="label" htmlFor="settings-logo">
            <span className="label-text">Business logo</span>
          </label>
          <Controller
            control={control}
            name="logoUrl"
            render={({ field }) => (
              <ImageUpload
                id="settings-logo"
                context="groomerLogo"
                label="Upload logo"
                value={field.value || undefined}
                onChange={(url) => field.onChange(url)}
                disabled={isSubmitting}
              />
            )}
          />
        </div>

        {/* Business name */}
        <div className="form-control">
          <label className="label" htmlFor="settings-business-name">
            <span className="label-text">Business name</span>
            <span className="label-text-alt text-base-content/50">
              {businessNameValue.length}/{BUSINESS_NAME_MAX_LENGTH}
            </span>
          </label>
          <input
            id="settings-business-name"
            type="text"
            maxLength={BUSINESS_NAME_MAX_LENGTH}
            autoComplete="organization"
            className={cx('input input-bordered min-h-[44px] w-full', errors.businessName && 'input-error')}
            aria-invalid={errors.businessName ? 'true' : 'false'}
            {...register('businessName')}
          />
          {errors.businessName && (
            <p className="mt-1 text-sm text-error" role="alert">
              {errors.businessName.message}
            </p>
          )}
        </div>

        {/* Phone + email */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="form-control">
            <label className="label" htmlFor="settings-phone">
              <span className="label-text">Business phone</span>
            </label>
            <input
              id="settings-phone"
              type="tel"
              maxLength={PHONE_MAX_LENGTH}
              autoComplete="tel"
              className={cx('input input-bordered min-h-[44px] w-full', errors.phone && 'input-error')}
              aria-invalid={errors.phone ? 'true' : 'false'}
              {...register('phone')}
            />
            {errors.phone && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.phone.message}
              </p>
            )}
          </div>

          <div className="form-control">
            <label className="label" htmlFor="settings-email">
              <span className="label-text">Business email</span>
            </label>
            <input
              id="settings-email"
              type="email"
              maxLength={BUSINESS_EMAIL_MAX_LENGTH}
              autoComplete="email"
              className={cx('input input-bordered min-h-[44px] w-full', errors.businessEmail && 'input-error')}
              aria-invalid={errors.businessEmail ? 'true' : 'false'}
              {...register('businessEmail')}
            />
            {errors.businessEmail && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.businessEmail.message}
              </p>
            )}
          </div>
        </div>

        {/* Deposit */}
        <div className="form-control">
          <label className="label" htmlFor="settings-deposit">
            <span className="label-text">Deposit amount ($)</span>
          </label>
          <input
            id="settings-deposit"
            type="number"
            inputMode="decimal"
            min={DEPOSIT_MIN}
            max={DEPOSIT_MAX}
            step="0.01"
            className={cx('input input-bordered min-h-[44px] w-full sm:max-w-xs', errors.depositAmount && 'input-error')}
            aria-invalid={errors.depositAmount ? 'true' : 'false'}
            {...register('depositAmount')}
          />
          {errors.depositAmount && (
            <p className="mt-1 text-sm text-error" role="alert">
              {errors.depositAmount.message}
            </p>
          )}
        </div>

        {/* Estimate rules */}
        <div className="form-control">
          <div className="mb-1 flex items-center justify-between">
            <span className="label-text font-medium">Estimate rules</span>
            <button
              type="button"
              onClick={() => append(EMPTY_RULE)}
              className="btn btn-ghost btn-sm min-h-[44px]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add rule</span>
            </button>
          </div>
          <p className="mb-3 text-xs text-base-content/60">
            Adjust the estimate by a percentage when a pet matches a coat condition and/or weight range.
          </p>

          {fields.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-base-300 p-4 text-sm text-base-content/60">
              No estimate rules yet. Add one to fine-tune pricing for specific coats or weights.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {fields.map((fieldItem, index) => {
                const ruleErrors = errors.estimateRules?.[index];
                return (
                  <div
                    key={fieldItem.id}
                    className="rounded-2xl border border-base-300 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-medium text-base-content">
                        Rule {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px] text-error"
                        aria-label={`Remove rule ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {/* Coat condition */}
                      <div className="form-control">
                        <label className="label" htmlFor={`rule-coat-${index}`}>
                          <span className="label-text">Coat condition</span>
                        </label>
                        <select
                          id={`rule-coat-${index}`}
                          className="select select-bordered min-h-[44px] w-full"
                          {...register(`estimateRules.${index}.coatCondition` as const)}
                        >
                          <option value="">Any</option>
                          {COAT_CONDITIONS.map((coat) => (
                            <option key={coat} value={coat}>
                              {COAT_LABELS[coat]}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Adjustment % */}
                      <div className="form-control">
                        <label className="label" htmlFor={`rule-adjust-${index}`}>
                          <span className="label-text">Adjustment (%)</span>
                        </label>
                        <input
                          id={`rule-adjust-${index}`}
                          type="number"
                          inputMode="numeric"
                          min={PRICE_ADJUSTMENT_MIN}
                          max={PRICE_ADJUSTMENT_MAX}
                          step={1}
                          className={cx(
                            'input input-bordered min-h-[44px] w-full',
                            ruleErrors?.priceAdjustmentPercent && 'input-error'
                          )}
                          aria-invalid={ruleErrors?.priceAdjustmentPercent ? 'true' : 'false'}
                          {...register(`estimateRules.${index}.priceAdjustmentPercent` as const)}
                        />
                        {ruleErrors?.priceAdjustmentPercent && (
                          <p className="mt-1 text-sm text-error" role="alert">
                            {ruleErrors.priceAdjustmentPercent.message}
                          </p>
                        )}
                      </div>

                      {/* Min weight */}
                      <div className="form-control">
                        <label className="label" htmlFor={`rule-min-${index}`}>
                          <span className="label-text">Min weight</span>
                        </label>
                        <input
                          id={`rule-min-${index}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.1"
                          className={cx(
                            'input input-bordered min-h-[44px] w-full',
                            ruleErrors?.weightMin && 'input-error'
                          )}
                          aria-invalid={ruleErrors?.weightMin ? 'true' : 'false'}
                          {...register(`estimateRules.${index}.weightMin` as const)}
                        />
                        {ruleErrors?.weightMin && (
                          <p className="mt-1 text-sm text-error" role="alert">
                            {ruleErrors.weightMin.message}
                          </p>
                        )}
                      </div>

                      {/* Max weight */}
                      <div className="form-control">
                        <label className="label" htmlFor={`rule-max-${index}`}>
                          <span className="label-text">Max weight</span>
                        </label>
                        <input
                          id={`rule-max-${index}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.1"
                          className={cx(
                            'input input-bordered min-h-[44px] w-full',
                            ruleErrors?.weightMax && 'input-error'
                          )}
                          aria-invalid={ruleErrors?.weightMax ? 'true' : 'false'}
                          {...register(`estimateRules.${index}.weightMax` as const)}
                        />
                        {ruleErrors?.weightMax && (
                          <p className="mt-1 text-sm text-error" role="alert">
                            {ruleErrors.weightMax.message}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Note */}
                    <div className="form-control mt-3">
                      <label className="label" htmlFor={`rule-note-${index}`}>
                        <span className="label-text">Note</span>
                      </label>
                      <input
                        id={`rule-note-${index}`}
                        type="text"
                        maxLength={ESTIMATE_RULE_NOTE_MAX_LENGTH}
                        className={cx(
                          'input input-bordered min-h-[44px] w-full',
                          ruleErrors?.note && 'input-error'
                        )}
                        aria-invalid={ruleErrors?.note ? 'true' : 'false'}
                        {...register(`estimateRules.${index}.note` as const)}
                      />
                      {ruleErrors?.note && (
                        <p className="mt-1 text-sm text-error" role="alert">
                          {ruleErrors.note.message}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={isSubmitting} className="btn btn-primary min-h-[44px]">
            {isSubmitting ? (
              <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Booking link (slug) section
// ---------------------------------------------------------------------------

function BookingLinkSection({ initialSlug }: { initialSlug: string }) {
  const [slug, setSlug] = React.useState(initialSlug);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await updateGroomerSlug(slug);
      if (result.ok) {
        setSlug(result.groomerSlug);
        toast.success('Booking link updated.');
      } else {
        // Inline availability / format error (Requirements 15.5, 15.6).
        setError(result.error);
      }
    } catch {
      setError("We couldn't update your booking link right now. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [slug]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking link</CardTitle>
        <CardDescription>
          The public address where clients book with you.
        </CardDescription>
      </CardHeader>

      <div className="form-control">
        <label className="label" htmlFor="settings-slug">
          <span className="label-text">Your booking link</span>
        </label>
        <div className="join w-full">
          <span className="btn btn-disabled join-item pointer-events-none min-h-[44px] normal-case">
            <Link2 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">/book/</span>
          </span>
          <input
            id="settings-slug"
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              if (error) setError(null);
            }}
            placeholder="your-business"
            autoComplete="off"
            className={cx('input input-bordered join-item min-h-[44px] w-full', error && 'input-error')}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? 'settings-slug-error' : undefined}
          />
        </div>
        {error ? (
          <p id="settings-slug-error" className="mt-1 text-sm text-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="mt-1 text-xs text-base-content/60">
            3–40 characters, using lowercase letters, numbers, and hyphens.
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary min-h-[44px]"
        >
          {saving ? (
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          ) : (
            'Save booking link'
          )}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function BusinessSettings({ initialSettings }: BusinessSettingsProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-base-content">Settings</h1>
        <p className="text-sm text-base-content/60">
          Configure your business profile and public booking link.
        </p>
      </div>

      <BusinessProfileForm initialSettings={initialSettings} />
      <BookingLinkSection initialSlug={initialSettings.groomerSlug} />
    </div>
  );
}

export default BusinessSettings;
