'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Building2,
  Scissors,
  ImageIcon,
  CalendarCheck,
  Clock3,
  Plus,
  Trash2,
  Check,
  Info,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { PageTransition } from '@/components/ui/PageTransition';
import { ImageUpload } from '@/components/ui/ImageUpload';
import {
  updateBusinessSettings,
  updateGroomerSlug,
  type BusinessSettingsData,
  type SettingsEstimateRule,
} from '@/actions/settings';
import {
  createService,
  type ServiceListItem,
} from '@/actions/services';
import {
  updateAvailabilityWindows,
  type AvailabilityConfig,
  type AvailabilityWindowDTO,
} from '@/actions/availability';
import {
  saveOnboardingStep,
  completeOnboarding,
} from '@/actions/onboarding';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding/constants';
import {
  serviceSchema,
  type ServiceFormInput,
  type ServiceFormValues,
  SERVICE_NAME_MAX_LENGTH,
  SERVICE_PRICE_MIN,
  SERVICE_PRICE_MAX,
  SERVICE_DURATION_MIN,
  SERVICE_DURATION_MAX,
} from '@/lib/validators/service';
import {
  validateWindow,
  isEndAfterStart,
} from '@/lib/availability/validate';
import { isValidSlugFormat } from '@/lib/validators/slug';
import {
  businessInfoSchema,
  type BusinessInfoInput,
} from '@/lib/validators/onboarding';

/**
 * OnboardingWizard — the guided, resumable multi-step setup flow for new
 * groomers (Requirement 2.1).
 *
 * Five steps, in the order mandated by Requirement 2.1:
 *   1. Business info    — business name, phone, email, and booking slug.
 *   2. Services & pricing — add at least one service.
 *   3. Logo upload      — brand logo (optional to upload, step is skippable
 *                          since a logo is not strictly required).
 *   4. Google Calendar  — service-account connection status; skippable (Req 2.7).
 *   5. First availability — weekly recurring windows.
 *
 * Cross-cutting behaviour:
 *   - A progress indicator shows "Step N of 5" (Requirement 2.4).
 *   - Each completed step is persisted server-side via `saveOnboardingStep`
 *     so an abandoned wizard resumes at the last incomplete step on next login
 *     (Requirement 2.2 / 2.5). The wizard initializes at `initialStep`.
 *   - Per-step validation blocks advancing on invalid input, with inline errors
 *     that don't clear valid values (Requirement 2.6).
 *   - Finishing step 5 calls `completeOnboarding()` then routes to /dashboard
 *     (Requirement 2.3).
 *   - Framer Motion step transitions (<=400ms) via PageTransition; 44px targets;
 *     sonner toasts for feedback.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The business fields the wizard needs to prefill + persist as a whole. */
interface InitialBusiness {
  businessName: string;
  phone: string;
  businessEmail: string;
  groomerSlug: string;
  logoUrl: string;
  depositAmount: number;
  estimateRules: SettingsEstimateRule[];
}

interface OnboardingWizardProps {
  /** Last completed step (0-based); the wizard opens at this step. */
  initialStep: number;
  initialBusiness: InitialBusiness;
  initialServices: ServiceListItem[];
  initialAvailability: AvailabilityConfig;
}

// ---------------------------------------------------------------------------
// Small helpers / constants
// ---------------------------------------------------------------------------

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

const STEP_META = [
  { title: 'Business info', icon: Building2 },
  { title: 'Services & pricing', icon: Scissors },
  { title: 'Logo', icon: ImageIcon },
  { title: 'Google Calendar', icon: CalendarCheck },
  { title: 'Availability', icon: Clock3 },
] as const;

/** 0 = Monday .. 6 = Sunday (matches GroomerProfile storage). */
const DAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** All valid 15-minute increment "HH:mm" slots from 00:00 to 23:45. */
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return out;
})();

function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Progress indicator (Requirement 2.4)
// ---------------------------------------------------------------------------

function ProgressIndicator({ current }: { current: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-base-content/70">
          Step {current + 1} of {ONBOARDING_TOTAL_STEPS}
        </p>
        <p className="text-sm text-base-content/50">{STEP_META[current].title}</p>
      </div>
      <ul className="flex items-center gap-2" aria-hidden="true">
        {STEP_META.map((meta, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={meta.title}
              className={cx(
                'h-2 flex-1 rounded-full transition-colors',
                done && 'bg-primary',
                active && 'bg-primary/60',
                !done && !active && 'bg-base-300'
              )}
            />
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Business info
// ---------------------------------------------------------------------------

function StepBusinessInfo({
  initial,
  onSaved,
}: {
  initial: InitialBusiness;
  onSaved: (next: Pick<
    InitialBusiness,
    'businessName' | 'phone' | 'businessEmail' | 'groomerSlug'
  >) => void;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BusinessInfoInput>({
    resolver: zodResolver(businessInfoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      businessName: initial.businessName,
      phone: initial.phone,
      businessEmail: initial.businessEmail,
      groomerSlug: initial.groomerSlug,
    },
  });

  const submit = handleSubmit(async (values) => {
    const slug = values.groomerSlug.trim().toLowerCase();

    // Guard the slug format client-side to keep the inline error adjacent to
    // the field (Requirement 2.6); the server re-checks format + uniqueness.
    if (!isValidSlugFormat(slug)) {
      setError('groomerSlug', {
        type: 'manual',
        message:
          'Use 3–40 characters: lowercase letters, numbers, and hyphens only.',
      });
      return;
    }

    // Persist the business profile fields. `updateBusinessSettings` requires a
    // full settings payload, so we carry through the values not edited here
    // (depositAmount, estimateRules, logoUrl) from the loaded profile.
    const settingsResult = await updateBusinessSettings({
      businessName: values.businessName,
      phone: values.phone ?? '',
      businessEmail: values.businessEmail ?? '',
      depositAmount: initial.depositAmount,
      estimateRules: initial.estimateRules,
      logoUrl: initial.logoUrl,
    });

    if (!settingsResult.ok) {
      if (settingsResult.fieldErrors) {
        for (const [field, messages] of Object.entries(settingsResult.fieldErrors)) {
          if (messages && messages.length > 0 && field in values) {
            setError(field as keyof BusinessInfoInput, {
              type: 'server',
              message: messages[0],
            });
          }
        }
        return;
      }
      toast.error(settingsResult.error ?? "We couldn't save your business info.", {
        duration: Infinity,
      });
      return;
    }

    // Persist the slug separately (format + uniqueness check, Req 15.5/15.6).
    const slugResult = await updateGroomerSlug(slug);
    if (!slugResult.ok) {
      setError('groomerSlug', { type: 'server', message: slugResult.error });
      return;
    }

    onSaved({
      businessName: values.businessName,
      phone: values.phone ?? '',
      businessEmail: values.businessEmail ?? '',
      groomerSlug: slugResult.groomerSlug,
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Business information">
      <div className="form-control">
        <label className="label" htmlFor="ob-business-name">
          <span className="label-text">Business name</span>
        </label>
        <input
          id="ob-business-name"
          type="text"
          maxLength={100}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="form-control">
          <label className="label" htmlFor="ob-phone">
            <span className="label-text">Business phone</span>
          </label>
          <input
            id="ob-phone"
            type="tel"
            maxLength={15}
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
          <label className="label" htmlFor="ob-email">
            <span className="label-text">Business email</span>
          </label>
          <input
            id="ob-email"
            type="email"
            maxLength={254}
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

      <div className="form-control">
        <label className="label" htmlFor="ob-slug">
          <span className="label-text">Booking link</span>
        </label>
        <label className="input input-bordered flex min-h-[44px] items-center gap-1 pr-2">
          <span className="shrink-0 text-sm text-base-content/50">/book/</span>
          <input
            id="ob-slug"
            type="text"
            maxLength={40}
            autoComplete="off"
            placeholder="your-business"
            className="grow bg-transparent outline-none"
            aria-invalid={errors.groomerSlug ? 'true' : 'false'}
            {...register('groomerSlug')}
          />
        </label>
        {errors.groomerSlug ? (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.groomerSlug.message}
          </p>
        ) : (
          <p className="mt-1 text-xs text-base-content/50">
            This is the public URL clients use to book with you.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={isSubmitting} className="btn btn-primary min-h-[44px]">
          {isSubmitting ? (
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          ) : (
            'Save & continue'
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Services & pricing
// ---------------------------------------------------------------------------

const EMPTY_SERVICE_FORM: ServiceFormInput = {
  name: '',
  description: '',
  basePrice: '' as unknown as number,
  durationMinutes: '' as unknown as number,
};

function StepServices({
  services,
  onAdded,
  onContinue,
}: {
  services: ServiceListItem[];
  onAdded: (service: ServiceListItem) => void;
  onContinue: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormInput, unknown, ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: EMPTY_SERVICE_FORM,
  });

  const submit = handleSubmit(async (values) => {
    const result = await createService(values);
    if (result.ok) {
      toast.success('Service added.');
      onAdded(result.service);
      reset(EMPTY_SERVICE_FORM);
      return;
    }
    if (result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (messages && messages.length > 0) {
          setError(field as keyof ServiceFormInput, {
            type: 'server',
            message: messages[0],
          });
        }
      }
      return;
    }
    toast.error(result.error ?? "We couldn't add the service.", { duration: Infinity });
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Added services */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-base-content/70">
          Your services ({services.length})
        </h3>
        {services.length === 0 ? (
          <p className="rounded-2xl bg-base-200 px-4 py-3 text-sm text-base-content/60">
            Add at least one service to continue.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {services.map((service) => (
              <li
                key={service.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-base-200 px-4 py-2"
              >
                <span className="min-w-0 truncate text-sm font-medium text-base-content">
                  {service.name}
                </span>
                <span className="shrink-0 text-sm text-base-content/70">
                  {formatPrice(service.basePrice)} · {service.durationMinutes}m
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add-service form */}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Add a service">
        <div className="form-control">
          <label className="label" htmlFor="ob-service-name">
            <span className="label-text">Service name</span>
          </label>
          <input
            id="ob-service-name"
            type="text"
            maxLength={SERVICE_NAME_MAX_LENGTH}
            autoComplete="off"
            className={cx('input input-bordered min-h-[44px] w-full', errors.name && 'input-error')}
            aria-invalid={errors.name ? 'true' : 'false'}
            {...register('name')}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-error" role="alert">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="form-control">
            <label className="label" htmlFor="ob-service-price">
              <span className="label-text">Base price ($)</span>
            </label>
            <input
              id="ob-service-price"
              type="number"
              inputMode="decimal"
              min={SERVICE_PRICE_MIN}
              max={SERVICE_PRICE_MAX}
              step="0.01"
              className={cx('input input-bordered min-h-[44px] w-full', errors.basePrice && 'input-error')}
              aria-invalid={errors.basePrice ? 'true' : 'false'}
              {...register('basePrice')}
            />
            {errors.basePrice && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.basePrice.message}
              </p>
            )}
          </div>

          <div className="form-control">
            <label className="label" htmlFor="ob-service-duration">
              <span className="label-text">Duration (minutes)</span>
            </label>
            <input
              id="ob-service-duration"
              type="number"
              inputMode="numeric"
              min={SERVICE_DURATION_MIN}
              max={SERVICE_DURATION_MAX}
              step={15}
              className={cx('input input-bordered min-h-[44px] w-full', errors.durationMinutes && 'input-error')}
              aria-invalid={errors.durationMinutes ? 'true' : 'false'}
              {...register('durationMinutes')}
            />
            {errors.durationMinutes && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.durationMinutes.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-start">
          <button type="submit" disabled={isSubmitting} className="btn btn-outline min-h-[44px] gap-1">
            {isSubmitting ? (
              <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add service
              </>
            )}
          </button>
        </div>
      </form>

      {/* Continue */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={services.length === 0}
          className="btn btn-primary min-h-[44px]"
        >
          Continue
        </button>
      </div>
      {services.length === 0 && (
        <p className="text-right text-xs text-base-content/50">
          Add at least one service to continue.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Logo upload
// ---------------------------------------------------------------------------

function StepLogo({
  initial,
  onSaved,
  onSkip,
}: {
  initial: InitialBusiness;
  onSaved: (logoUrl: string) => void;
  onSkip: () => void;
}) {
  const [logoUrl, setLogoUrl] = React.useState(initial.logoUrl);
  const [saving, setSaving] = React.useState(false);

  const persistLogo = async (nextLogoUrl: string) => {
    setSaving(true);
    try {
      const result = await updateBusinessSettings({
        businessName: initial.businessName,
        phone: initial.phone,
        businessEmail: initial.businessEmail,
        depositAmount: initial.depositAmount,
        estimateRules: initial.estimateRules,
        logoUrl: nextLogoUrl,
      });
      if (result.ok) {
        onSaved(nextLogoUrl);
      } else {
        toast.error(result.error ?? "We couldn't save your logo.", { duration: Infinity });
      }
    } catch {
      toast.error("We couldn't save your logo. Please try again.", { duration: Infinity });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-medium text-base-content/70">Business logo</h3>
        <p className="text-sm text-base-content/60">
          Upload a PNG, JPG, or WebP up to 5MB. This appears on your booking page
          and pet cards.
        </p>
      </div>

      <ImageUpload
        context="groomerLogo"
        value={logoUrl}
        onChange={(url) => setLogoUrl(url)}
        label="Upload logo"
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onSkip}
          disabled={saving}
          className="btn btn-ghost min-h-[44px]"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={() => void persistLogo(logoUrl)}
          disabled={saving || !logoUrl}
          className="btn btn-primary min-h-[44px]"
        >
          {saving ? (
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          ) : (
            'Save & continue'
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Calendar feed (native calendar; read-only ICS export — Master Spec §9)
// ---------------------------------------------------------------------------

function StepCalendar({
  onContinue,
  onSkip,
}: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <CalendarCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        <h3 className="text-lg font-semibold text-base-content">Your calendar</h3>
      </div>

      <p className="text-sm text-base-content/70">
        PawPort has its own built-in calendar — no external calendar to connect.
        Every booking lands here automatically. When you&apos;re set up, you can
        subscribe to a read-only feed of your appointments in Apple, Google, or
        Outlook calendar from your Availability settings.
      </p>

      <div className="alert alert-info flex items-start gap-2 text-sm" role="status">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Nothing to do here. You&apos;ll set your weekly hours next, then grab
          your calendar feed link anytime from Availability.
        </span>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onSkip} className="btn btn-ghost min-h-[44px]">
          Skip for now
        </button>
        <button type="button" onClick={onContinue} className="btn btn-primary min-h-[44px]">
          Continue
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — First availability
// ---------------------------------------------------------------------------

interface EditableWindow extends AvailabilityWindowDTO {
  localId: string;
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `ob-w-${localIdCounter}`;
}

function makeDefaultWindow(dayOfWeek: number): EditableWindow {
  return { localId: nextLocalId(), dayOfWeek, startTime: '09:00', endTime: '17:00' };
}

function TimeSelect({
  value,
  onChange,
  invalid,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      aria-invalid={invalid ? 'true' : 'false'}
      className={cx('select select-bordered min-h-[44px]', invalid && 'select-error')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {!TIME_OPTIONS.includes(value) && <option value={value}>{value}</option>}
      {TIME_OPTIONS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

function StepAvailability({
  initialWindows,
  onFinish,
  finishing,
}: {
  initialWindows: AvailabilityWindowDTO[];
  onFinish: () => void;
  finishing: boolean;
}) {
  const [windows, setWindows] = React.useState<EditableWindow[]>(() =>
    initialWindows.length > 0
      ? initialWindows.map((w) => ({ ...w, localId: nextLocalId() }))
      : [makeDefaultWindow(0)]
  );
  const [saving, setSaving] = React.useState(false);

  const updateField = (
    localId: string,
    field: 'startTime' | 'endTime',
    value: string
  ) => {
    setWindows((prev) =>
      prev.map((w) => (w.localId === localId ? { ...w, [field]: value } : w))
    );
  };

  const addWindow = (dayOfWeek: number) => {
    setWindows((prev) => [...prev, makeDefaultWindow(dayOfWeek)]);
  };

  const removeWindow = (localId: string) => {
    setWindows((prev) => prev.filter((w) => w.localId !== localId));
  };

  // First validation error across all windows blocks saving (Req 2.6 / 14.6).
  const firstError = React.useMemo(() => {
    if (windows.length === 0) {
      return 'Add at least one availability window.';
    }
    for (const w of windows) {
      const err = validateWindow(w);
      if (err) return err;
    }
    return null;
  }, [windows]);

  const handleFinish = async () => {
    if (firstError) {
      toast.error(firstError, { duration: Infinity });
      return;
    }
    setSaving(true);
    try {
      const result = await updateAvailabilityWindows(
        windows.map((w) => ({
          dayOfWeek: w.dayOfWeek,
          startTime: w.startTime,
          endTime: w.endTime,
        }))
      );
      if (!result.ok) {
        toast.error(result.error, { duration: Infinity });
        setSaving(false);
        return;
      }
      // Persisted; hand control to the wizard to complete onboarding.
      onFinish();
    } catch {
      toast.error("We couldn't save your availability. Please try again.", {
        duration: Infinity,
      });
      setSaving(false);
    }
  };

  const busy = saving || finishing;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-medium text-base-content/70">Weekly hours</h3>
        <p className="text-sm text-base-content/60">
          Set the times you&apos;re available to take bookings each week.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {DAY_LABELS.map((label, dayOfWeek) => {
          const dayWindows = windows.filter((w) => w.dayOfWeek === dayOfWeek);
          return (
            <div
              key={label}
              className="flex flex-col gap-2 border-b border-base-200 pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="w-full shrink-0 pt-2 text-sm font-medium text-base-content sm:w-28">
                {label}
              </div>
              <div className="flex w-full flex-col gap-2">
                {dayWindows.length === 0 && (
                  <p className="py-2 text-sm text-base-content/50">Closed</p>
                )}
                {dayWindows.map((w) => {
                  const rangeInvalid = !isEndAfterStart(w.startTime, w.endTime);
                  return (
                    <div key={w.localId} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <TimeSelect
                          value={w.startTime}
                          onChange={(v) => updateField(w.localId, 'startTime', v)}
                          invalid={rangeInvalid}
                          label={`${label} start time`}
                        />
                        <span className="text-base-content/50">to</span>
                        <TimeSelect
                          value={w.endTime}
                          onChange={(v) => updateField(w.localId, 'endTime', v)}
                          invalid={rangeInvalid}
                          label={`${label} end time`}
                        />
                        <button
                          type="button"
                          onClick={() => removeWindow(w.localId)}
                          className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px] text-error"
                          aria-label={`Remove ${label} window ${w.startTime} to ${w.endTime}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      {rangeInvalid && (
                        <p className="text-sm text-error" role="alert">
                          End time must be after start time.
                        </p>
                      )}
                    </div>
                  );
                })}
                <div>
                  <button
                    type="button"
                    onClick={() => addWindow(dayOfWeek)}
                    className="btn btn-ghost btn-sm min-h-[44px] gap-1"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add hours
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {firstError && (
          <p className="text-sm text-error sm:mr-auto" role="alert">
            {firstError}
          </p>
        )}
        <button
          type="button"
          onClick={handleFinish}
          disabled={busy || Boolean(firstError)}
          className="btn btn-primary min-h-[44px] gap-1"
        >
          {busy ? (
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          ) : (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              Finish setup
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root wizard
// ---------------------------------------------------------------------------

export function OnboardingWizard({
  initialStep,
  initialBusiness,
  initialServices,
  initialAvailability,
}: OnboardingWizardProps) {
  const router = useRouter();

  // Clamp the initial step into range in case of stale/corrupt data.
  const startStep = Math.min(
    Math.max(0, initialStep),
    ONBOARDING_TOTAL_STEPS - 1
  );
  const [step, setStep] = React.useState(startStep);
  const [business, setBusiness] = React.useState(initialBusiness);
  const [services, setServices] = React.useState(initialServices);
  const [finishing, setFinishing] = React.useState(false);

  /**
   * Advance to `nextStep` and persist the completed step server-side so an
   * abandoned wizard resumes at the last incomplete step (Req 2.2 / 2.5).
   * Persistence is best-effort: a save failure surfaces a toast but does not
   * block the user from continuing within this session.
   */
  const advanceTo = React.useCallback(async (nextStep: number) => {
    setStep(nextStep);
    const result = await saveOnboardingStep(nextStep);
    if (!result.ok) {
      toast.error(result.error, { duration: Infinity });
    }
  }, []);

  const handleFinish = React.useCallback(async () => {
    setFinishing(true);
    const result = await completeOnboarding();
    if (!result.ok) {
      toast.error(result.error, { duration: Infinity });
      setFinishing(false);
      return;
    }
    toast.success("You're all set! Welcome to PawPort.");
    router.push('/dashboard');
  }, [router]);

  const stepTitles = STEP_META.map((m) => m.title);
  const CurrentIcon = STEP_META[step].icon;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-bold text-base-content">Set up your business</h1>
        <p className="text-sm text-base-content/60">
          A few quick steps and you&apos;ll be ready to accept bookings.
        </p>
      </div>

      <ProgressIndicator current={step} />

      <PageTransition transitionKey={`onboarding-step-${step}`}>
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <CurrentIcon className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-base-content">{stepTitles[step]}</h2>
          </div>

          {step === 0 && (
            <StepBusinessInfo
              initial={business}
              onSaved={(next) => {
                setBusiness((prev) => ({ ...prev, ...next }));
                void advanceTo(1);
              }}
            />
          )}

          {step === 1 && (
            <StepServices
              services={services}
              onAdded={(service) => setServices((prev) => [service, ...prev])}
              onContinue={() => void advanceTo(2)}
            />
          )}

          {step === 2 && (
            <StepLogo
              initial={business}
              onSaved={(logoUrl) => {
                setBusiness((prev) => ({ ...prev, logoUrl }));
                void advanceTo(3);
              }}
              onSkip={() => void advanceTo(3)}
            />
          )}

          {step === 3 && (
            <StepCalendar
              onContinue={() => void advanceTo(4)}
              onSkip={() => void advanceTo(4)}
            />
          )}

          {step === 4 && (
            <StepAvailability
              initialWindows={initialAvailability.windows}
              onFinish={() => void handleFinish()}
              finishing={finishing}
            />
          )}
        </Card>
      </PageTransition>

      {step > 0 && step < ONBOARDING_TOTAL_STEPS && !finishing && (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setStep((prev) => Math.max(0, prev - 1))}
            className="btn btn-ghost btn-sm min-h-[44px]"
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}

export default OnboardingWizard;
