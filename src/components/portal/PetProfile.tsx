'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CalendarClock,
  ClipboardCopy,
  ExternalLink,
  IdCard,
  PawPrint,
  Pencil,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { updatePet, generateDigitalPetCard } from '@/actions/pets';
import type { PetProfile as PetProfileData, PetServiceHistoryEntry } from '@/actions/pets';
import {
  petEditSchema,
  type PetEditFormInput,
  type PetEditFormValues,
  PET_NAME_MAX_LENGTH,
  PET_BREED_MAX_LENGTH,
  PET_NOTES_MAX_LENGTH,
} from '@/lib/validators/pet';
import { TEMPERAMENT_OPTIONS } from '@/config/temperaments';
import { COAT_CONDITION_OPTIONS } from '@/config/coat-conditions';
import { SPECIAL_FLAG_OPTIONS } from '@/config/special-flags';

/**
 * PetProfile — client component for the Groomer Portal pet profile page.
 *
 * Renders all pet fields (Requirement 11.1), a reverse-chronological service
 * history timeline (Requirement 11.2), an edit mode backed by React Hook Form
 * with `zodResolver(petEditSchema)` that blocks confirmation on invalid input
 * and shows inline field errors while preserving entered data (Requirements
 * 11.5 / 11.6), and a "Generate Digital Pet Card" affordance that only
 * surfaces a shareable card when generation succeeds (Requirement 11.3
 * boundary).
 *
 * The parent server component fetches the pet + service history via `getPet`
 * and passes plain, serializable data here. Service-history dates arrive as
 * ISO strings so the payload is JSON-safe.
 *
 * _Requirements: 11.1, 11.2, 11.5, 11.6_
 */

/** JSON-safe service-history entry (date serialized to an ISO string). */
export interface SerializableServiceHistoryEntry {
  appointmentId: string;
  date: string;
  serviceName: string;
  notes?: string;
  status: string;
}

interface PetProfileProps {
  pet: PetProfileData;
  serviceHistory: SerializableServiceHistoryEntry[];
}

/** Convert a server `PetServiceHistoryEntry` into the serializable shape. */
export function toSerializableHistory(
  entries: PetServiceHistoryEntry[]
): SerializableServiceHistoryEntry[] {
  return entries.map((e) => ({
    appointmentId: e.appointmentId,
    date: new Date(e.date).toISOString(),
    serviceName: e.serviceName,
    notes: e.notes,
    status: e.status,
  }));
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Lookup maps from stored value → human-friendly label. */
const TEMPERAMENT_LABELS = new Map<string, string>(
  TEMPERAMENT_OPTIONS.map((o) => [o.value, o.label])
);
const COAT_LABELS = new Map<string, string>(
  COAT_CONDITION_OPTIONS.map((o) => [o.value, o.label])
);
const FLAG_LABELS = new Map<string, string>(
  SPECIAL_FLAG_OPTIONS.map((o) => [o.value, o.label])
);

/** DaisyUI badge class per appointment status. */
const STATUS_BADGE: Record<string, string> = {
  upcoming: 'badge-info',
  'in-progress': 'badge-warning',
  completed: 'badge-success',
  cancelled: 'badge-error',
};

const STATUS_LABEL: Record<string, string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Format an ISO timestamp as a friendly local date. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Map the raw form values into the `PetEditFormInput` shape RHF holds. */
function toFormValues(pet: PetProfileData): PetEditFormInput {
  return {
    name: pet.name,
    breed: pet.breed,
    weight: pet.weight,
    weightUnit: pet.weightUnit,
    age: pet.age,
    temperament: pet.temperament,
    coatCondition: pet.coatCondition,
    specialFlags: pet.specialFlags ?? [],
    notes: pet.notes ?? '',
  };
}

// ---------------------------------------------------------------------------
// Read-only view
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-base-content/50">
        {label}
      </dt>
      <dd className="text-sm text-base-content">{value}</dd>
    </div>
  );
}

function PetDetails({ pet }: { pet: PetProfileData }) {
  const flags = pet.specialFlags ?? [];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <DetailRow label="Breed" value={pet.breed} />
      <DetailRow label="Weight" value={`${pet.weight} ${pet.weightUnit}`} />
      <DetailRow label="Age" value={`${pet.age} ${pet.age === 1 ? 'year' : 'years'}`} />
      <DetailRow
        label="Temperament"
        value={TEMPERAMENT_LABELS.get(pet.temperament) ?? pet.temperament}
      />
      <DetailRow
        label="Coat condition"
        value={COAT_LABELS.get(pet.coatCondition) ?? pet.coatCondition}
      />
      <div className="flex flex-col gap-1 sm:col-span-2">
        <dt className="text-xs font-medium uppercase tracking-wide text-base-content/50">
          Special flags
        </dt>
        <dd>
          {flags.length === 0 ? (
            <span className="text-sm text-base-content/50">None</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {flags.map((flag) => (
                <span key={flag} className="badge badge-outline">
                  {FLAG_LABELS.get(flag) ?? flag}
                </span>
              ))}
            </div>
          )}
        </dd>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <dt className="text-xs font-medium uppercase tracking-wide text-base-content/50">
          Notes
        </dt>
        <dd className="whitespace-pre-wrap text-sm text-base-content">
          {pet.notes ? pet.notes : <span className="text-base-content/50">No notes</span>}
        </dd>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

function PetEditForm({
  pet,
  onCancel,
  onSaved,
}: {
  pet: PetProfileData;
  onCancel: () => void;
  onSaved: (values: PetEditFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PetEditFormInput, unknown, PetEditFormValues>({
    resolver: zodResolver(petEditSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: toFormValues(pet),
  });

  const notesValue = watch('notes') ?? '';

  // Only proceed when RHF/Zod validation passes; invalid submits are blocked by
  // handleSubmit and never reach here, so no confirmation is shown (Req 11.5).
  const submit = handleSubmit(async (values) => {
    const result = await updatePet(pet.id, values);
    if (result.ok) {
      toast.success('Pet profile updated.');
      onSaved(values);
      return;
    }

    // Surface server-side field errors inline without clearing entered data
    // (Requirement 11.6). Fall back to a general error toast otherwise.
    if (result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (messages && messages.length > 0) {
          setError(field as keyof PetEditFormInput, {
            type: 'server',
            message: messages[0],
          });
        }
      }
      return;
    }

    toast.error(result.error ?? "We couldn't save your changes. Please try again.", {
      duration: Infinity,
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Edit pet profile">
      {/* Name */}
      <div className="form-control">
        <label className="label" htmlFor="edit-name">
          <span className="label-text">Pet name</span>
        </label>
        <input
          id="edit-name"
          type="text"
          maxLength={PET_NAME_MAX_LENGTH}
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

      {/* Breed */}
      <div className="form-control">
        <label className="label" htmlFor="edit-breed">
          <span className="label-text">Breed</span>
        </label>
        <input
          id="edit-breed"
          type="text"
          maxLength={PET_BREED_MAX_LENGTH}
          autoComplete="off"
          className={cx('input input-bordered min-h-[44px] w-full', errors.breed && 'input-error')}
          aria-invalid={errors.breed ? 'true' : 'false'}
          {...register('breed')}
        />
        {errors.breed && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.breed.message}
          </p>
        )}
      </div>

      {/* Weight + unit */}
      <div className="form-control">
        <label className="label" htmlFor="edit-weight">
          <span className="label-text">Weight</span>
        </label>
        <div className="flex gap-2">
          <input
            id="edit-weight"
            type="number"
            inputMode="decimal"
            min={1}
            max={200}
            step="any"
            className={cx('input input-bordered min-h-[44px] w-full', errors.weight && 'input-error')}
            aria-invalid={errors.weight ? 'true' : 'false'}
            {...register('weight')}
          />
          <select
            aria-label="Weight unit"
            className={cx('select select-bordered min-h-[44px]', errors.weightUnit && 'select-error')}
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
        <label className="label" htmlFor="edit-age">
          <span className="label-text">Age (years)</span>
        </label>
        <input
          id="edit-age"
          type="number"
          inputMode="numeric"
          min={0}
          max={30}
          step="any"
          className={cx('input input-bordered min-h-[44px] w-full', errors.age && 'input-error')}
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
        <label className="label" htmlFor="edit-temperament">
          <span className="label-text">Temperament</span>
        </label>
        <select
          id="edit-temperament"
          className={cx('select select-bordered min-h-[44px] w-full', errors.temperament && 'select-error')}
          aria-invalid={errors.temperament ? 'true' : 'false'}
          {...register('temperament')}
        >
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
        <label className="label" htmlFor="edit-coat">
          <span className="label-text">Coat condition</span>
        </label>
        <select
          id="edit-coat"
          className={cx('select select-bordered min-h-[44px] w-full', errors.coatCondition && 'select-error')}
          aria-invalid={errors.coatCondition ? 'true' : 'false'}
          {...register('coatCondition')}
        >
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

      {/* Special flags */}
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
                  const inputId = `edit-flag-${option.value}`;
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
        <label className="label" htmlFor="edit-notes">
          <span className="label-text">Notes</span>
          <span className="label-text-alt text-base-content/50">
            {notesValue.length}/{PET_NOTES_MAX_LENGTH}
          </span>
        </label>
        <textarea
          id="edit-notes"
          rows={3}
          maxLength={PET_NOTES_MAX_LENGTH}
          className={cx('textarea textarea-bordered w-full', errors.notes && 'textarea-error')}
          aria-invalid={errors.notes ? 'true' : 'false'}
          {...register('notes')}
        />
        {errors.notes && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.notes.message}
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="btn btn-ghost min-h-[44px]"
        >
          Cancel
        </button>
        <button type="submit" disabled={isSubmitting} className="btn btn-primary min-h-[44px]">
          {isSubmitting ? (
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          ) : (
            'Save changes'
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Service history timeline
// ---------------------------------------------------------------------------

function ServiceTimeline({
  history,
}: {
  history: SerializableServiceHistoryEntry[];
}) {
  if (history.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock className="h-10 w-10" aria-hidden="true" />}
        title="No service history yet"
        description="Completed appointments for this pet will appear here."
      />
    );
  }

  return (
    <ol className="relative flex flex-col gap-4 border-l border-base-300 pl-5">
      {history.map((entry) => (
        <li key={entry.appointmentId} className="relative">
          <span
            className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-base-100"
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-base-content">{entry.serviceName}</p>
            <span className={cx('badge', STATUS_BADGE[entry.status] ?? 'badge-ghost')}>
              {STATUS_LABEL[entry.status] ?? entry.status}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-base-content/60">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            {formatDate(entry.date)}
          </p>
          {entry.notes && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-base-content/80">
              {entry.notes}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Digital Pet Card generator
// ---------------------------------------------------------------------------

function DigitalCardPanel({ petId }: { petId: string }) {
  const [generating, setGenerating] = React.useState(false);
  const [card, setCard] = React.useState<
    { cardId: string; shareableUrl: string } | null
  >(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateDigitalPetCard(petId);
      // Only present the card once generation succeeds (Requirement 11.3
      // boundary); a failure shows an error and leaves the panel unchanged.
      if (result.ok) {
        setCard({
          cardId: result.card.cardId,
          shareableUrl: result.card.shareableUrl,
        });
        toast.success('Digital Pet Card ready.');
      } else {
        toast.error(result.error ?? "We couldn't generate the pet card.", {
          duration: Infinity,
        });
      }
    } catch {
      toast.error("We couldn't generate the pet card. Please try again.", {
        duration: Infinity,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.shareableUrl);
      toast.success('Link copied to clipboard.');
    } catch {
      toast.error('Could not copy the link. Please copy it manually.', {
        duration: Infinity,
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="btn btn-primary min-h-[44px] w-full sm:w-auto"
      >
        {generating ? (
          <span className="loading loading-spinner loading-sm" aria-hidden="true" />
        ) : (
          <>
            <IdCard className="h-4 w-4" aria-hidden="true" />
            Generate Digital Pet Card
          </>
        )}
      </button>

      {card && (
        <div className="flex flex-col gap-3 rounded-2xl bg-base-200 p-4">
          <p className="text-sm font-medium text-base-content">Shareable link</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              readOnly
              value={card.shareableUrl}
              aria-label="Shareable pet card link"
              className="input input-bordered min-h-[44px] w-full text-sm"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="btn btn-outline min-h-[44px] flex-1 sm:flex-none"
              >
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                Copy
              </button>
              <Link
                href={`/pet-card/${card.cardId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost min-h-[44px] flex-1 sm:flex-none"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function PetProfile({ pet: initialPet, serviceHistory }: PetProfileProps) {
  const [pet, setPet] = React.useState<PetProfileData>(initialPet);
  const [editing, setEditing] = React.useState(false);

  const handleSaved = React.useCallback(
    (values: PetEditFormValues) => {
      // Reflect the saved edits locally so the read-only view is up to date
      // without a full reload.
      setPet((prev) => ({
        ...prev,
        name: values.name,
        breed: values.breed,
        weight: values.weight,
        weightUnit: values.weightUnit,
        age: values.age,
        temperament: values.temperament,
        coatCondition: values.coatCondition,
        specialFlags: values.specialFlags ?? [],
        notes: values.notes ? values.notes : undefined,
      }));
      setEditing(false);
    },
    []
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* Header: photo + name */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-base-200">
              {pet.photoUrl ? (
                <Image
                  src={pet.photoUrl}
                  alt={`${pet.name}'s photo`}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-base-content/40">
                  <PawPrint className="h-8 w-8" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-base-content">{pet.name}</h1>
              <p className="text-base-content/60">{pet.breed}</p>
            </div>
          </div>

          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn btn-ghost min-h-[44px]"
              aria-label="Edit pet profile"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit
            </button>
          )}
        </div>
      </Card>

      {/* Details / edit form */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-base-content">
            {editing ? 'Edit profile' : 'Profile'}
          </h2>
          {editing && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn btn-ghost btn-sm min-h-[44px]"
              aria-label="Close edit form"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {editing ? (
          <PetEditForm
            pet={pet}
            onCancel={() => setEditing(false)}
            onSaved={handleSaved}
          />
        ) : (
          <PetDetails pet={pet} />
        )}
      </Card>

      {/* Digital Pet Card */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-base-content">Digital Pet Card</h2>
        <DigitalCardPanel petId={pet.id} />
      </Card>

      {/* Service history */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-base-content">Service history</h2>
        <ServiceTimeline history={serviceHistory} />
      </Card>
    </div>
  );
}

export default PetProfile;
