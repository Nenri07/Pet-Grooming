'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Clock, Pencil, Plus, Scissors, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  createService,
  updateService,
  deleteService,
  toggleServiceActive,
  type ServiceListItem,
} from '@/actions/services';
import {
  serviceSchema,
  type ServiceFormInput,
  type ServiceFormValues,
  SERVICE_NAME_MAX_LENGTH,
  SERVICE_DESCRIPTION_MAX_LENGTH,
  SERVICE_PRICE_MIN,
  SERVICE_PRICE_MAX,
  SERVICE_DURATION_MIN,
  SERVICE_DURATION_MAX,
} from '@/lib/validators/service';

/**
 * ServicesManager — client component for the Groomer Portal services page.
 *
 * Lists every service (name, price, duration, active status), offers a
 * create/edit form backed by React Hook Form + `zodResolver(serviceSchema)`
 * (Requirement 13.1 / 13.2), a delete action with a confirmation dialog that
 * surfaces the delete-blocked error (including the upcoming-appointment count)
 * as a persistent toast (Requirement 13.4), and an active/inactive toggle to
 * hide a service from the public booking flow without deleting it
 * (Requirement 13.5).
 *
 * The parent server component fetches the services via `listServices` and
 * passes plain, serializable rows in; this component owns all local state and
 * optimistic UI updates so the list stays in sync after each mutation without
 * a full reload.
 *
 * _Requirements: 13.1, 13.2, 13.4, 13.5_
 */

interface ServicesManagerProps {
  /** The groomer's services rendered on initial load. */
  initialServices: ServiceListItem[];
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Format a numeric price as a 2-decimal currency string. */
function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Format a duration in minutes as a friendly "1h 30m" / "45m" string. */
function formatDuration(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/** Empty defaults for the create form. */
const EMPTY_FORM: ServiceFormInput = {
  name: '',
  description: '',
  basePrice: '' as unknown as number,
  durationMinutes: '' as unknown as number,
};

/** Map an existing service row into the form input shape. */
function toFormValues(service: ServiceListItem): ServiceFormInput {
  return {
    name: service.name,
    description: service.description ?? '',
    basePrice: service.basePrice,
    durationMinutes: service.durationMinutes,
  };
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

function ServiceForm({
  editing,
  onCancel,
  onSaved,
}: {
  /** The service being edited, or null when creating a new one. */
  editing: ServiceListItem | null;
  onCancel: () => void;
  onSaved: (service: ServiceListItem) => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormInput, unknown, ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: editing ? toFormValues(editing) : EMPTY_FORM,
  });

  const descriptionValue = watch('description') ?? '';

  const submit = handleSubmit(async (values) => {
    const result = editing
      ? await updateService(editing.id, values)
      : await createService(values);

    if (result.ok) {
      toast.success(editing ? 'Service updated.' : 'Service created.');
      onSaved(result.service);
      return;
    }

    // Surface server-side field errors inline without clearing entered data
    // (Requirement 21.1). Fall back to a persistent error toast otherwise.
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

    toast.error(result.error ?? "We couldn't save the service. Please try again.", {
      duration: Infinity,
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label={editing ? 'Edit service' : 'Create service'}>
      {/* Name */}
      <div className="form-control">
        <label className="label" htmlFor="service-name">
          <span className="label-text">Service name</span>
        </label>
        <input
          id="service-name"
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

      {/* Description */}
      <div className="form-control">
        <label className="label" htmlFor="service-description">
          <span className="label-text">Description</span>
          <span className="label-text-alt text-base-content/50">
            {descriptionValue.length}/{SERVICE_DESCRIPTION_MAX_LENGTH}
          </span>
        </label>
        <textarea
          id="service-description"
          rows={3}
          maxLength={SERVICE_DESCRIPTION_MAX_LENGTH}
          className={cx('textarea textarea-bordered w-full', errors.description && 'textarea-error')}
          aria-invalid={errors.description ? 'true' : 'false'}
          {...register('description')}
        />
        {errors.description && (
          <p className="mt-1 text-sm text-error" role="alert">
            {errors.description.message}
          </p>
        )}
      </div>

      {/* Base price + duration */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="form-control">
          <label className="label" htmlFor="service-price">
            <span className="label-text">Base price ($)</span>
          </label>
          <input
            id="service-price"
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
          <label className="label" htmlFor="service-duration">
            <span className="label-text">Duration (minutes)</span>
          </label>
          <input
            id="service-duration"
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
          ) : editing ? (
            'Save changes'
          ) : (
            'Create service'
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteConfirm({
  service,
  onCancel,
  onConfirm,
  deleting,
}: {
  service: ServiceListItem;
  onCancel: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Confirm delete service">
      <div className="absolute inset-0 bg-black/40" onClick={deleting ? undefined : onCancel} aria-hidden="true" />
      <Card className="relative z-10 w-full max-w-md">
        <h2 className="text-lg font-semibold text-base-content">Delete service?</h2>
        <p className="mt-2 text-sm text-base-content/70">
          Are you sure you want to delete <span className="font-medium">{service.name}</span>? This
          can&apos;t be undone.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={deleting} className="btn btn-ghost min-h-[44px]">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={deleting} className="btn btn-error min-h-[44px]">
            {deleting ? (
              <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service row
// ---------------------------------------------------------------------------

function ServiceRow({
  service,
  onEdit,
  onRequestDelete,
  onToggle,
  toggling,
}: {
  service: ServiceListItem;
  onEdit: () => void;
  onRequestDelete: () => void;
  onToggle: (next: boolean) => void;
  toggling: boolean;
}) {
  const toggleId = `service-active-${service.id}`;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-base-content">{service.name}</h3>
            <span className={cx('badge', service.isActive ? 'badge-success' : 'badge-ghost')}>
              {service.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {service.description && (
            <p className="mt-1 line-clamp-2 text-sm text-base-content/60">{service.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-base-content/70">
            <span className="font-medium text-base-content">{formatPrice(service.basePrice)}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
              {formatDuration(service.durationMinutes)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
            aria-label={`Edit ${service.name}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRequestDelete}
            className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px] text-error"
            aria-label={`Delete ${service.name}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <label htmlFor={toggleId} className="label min-h-[44px] cursor-pointer justify-start gap-3">
        <input
          id={toggleId}
          type="checkbox"
          className="toggle toggle-primary"
          checked={service.isActive}
          disabled={toggling}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="label-text">
          {service.isActive ? 'Visible in booking' : 'Hidden from booking'}
        </span>
      </label>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function ServicesManager({ initialServices }: ServicesManagerProps) {
  const [services, setServices] = React.useState<ServiceListItem[]>(initialServices);
  // Form mode: null (closed), 'create', or a service being edited.
  const [formMode, setFormMode] = React.useState<'create' | ServiceListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ServiceListItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const handleSaved = React.useCallback((saved: ServiceListItem) => {
    setServices((prev) => {
      const exists = prev.some((s) => s.id === saved.id);
      if (exists) {
        return prev.map((s) => (s.id === saved.id ? { ...s, ...saved } : s));
      }
      // New service — prepend so it matches the newest-first server ordering.
      return [saved, ...prev];
    });
    setFormMode(null);
  }, []);

  const handleToggle = React.useCallback(
    async (service: ServiceListItem, next: boolean) => {
      setTogglingId(service.id);
      // Optimistic flip so the toggle feels instant.
      setServices((prev) =>
        prev.map((s) => (s.id === service.id ? { ...s, isActive: next } : s))
      );
      try {
        const result = await toggleServiceActive(service.id, next);
        if (!result.ok) {
          // Roll back on failure.
          setServices((prev) =>
            prev.map((s) => (s.id === service.id ? { ...s, isActive: !next } : s))
          );
          toast.error(result.error, { duration: Infinity });
        } else {
          toast.success(next ? 'Service shown in booking.' : 'Service hidden from booking.');
        }
      } catch {
        setServices((prev) =>
          prev.map((s) => (s.id === service.id ? { ...s, isActive: !next } : s))
        );
        toast.error("We couldn't update the service. Please try again.", {
          duration: Infinity,
        });
      } finally {
        setTogglingId(null);
      }
    },
    []
  );

  const handleConfirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteService(deleteTarget.id);
      if (result.ok) {
        setServices((prev) => prev.filter((s) => s.id !== deleteTarget.id));
        toast.success('Service deleted.');
        setDeleteTarget(null);
      } else {
        // Delete blocked (e.g. upcoming appointments) — surface as a persistent
        // toast with the count (Requirement 13.4) and keep the dialog closed.
        toast.error(result.error, { duration: Infinity });
        setDeleteTarget(null);
      }
    } catch {
      toast.error("We couldn't delete the service. Please try again.", {
        duration: Infinity,
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-base-content">Services</h1>
          <p className="text-sm text-base-content/60">
            Manage the services clients can book and their pricing.
          </p>
        </div>
        {formMode === null && (
          <button
            type="button"
            onClick={() => setFormMode('create')}
            className="btn btn-primary min-h-[44px]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">New service</span>
          </button>
        )}
      </div>

      {/* Create / edit form */}
      {formMode !== null && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-base-content">
              {formMode === 'create' ? 'New service' : 'Edit service'}
            </h2>
            <button
              type="button"
              onClick={() => setFormMode(null)}
              className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
              aria-label="Close form"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <ServiceForm
            editing={formMode === 'create' ? null : formMode}
            onCancel={() => setFormMode(null)}
            onSaved={handleSaved}
          />
        </Card>
      )}

      {/* Service list */}
      {services.length === 0 ? (
        <EmptyState
          icon={<Scissors className="h-10 w-10" aria-hidden="true" />}
          title="No services yet"
          description="Create your first service so clients can book it during checkout."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              onEdit={() => setFormMode(service)}
              onRequestDelete={() => setDeleteTarget(service)}
              onToggle={(next) => handleToggle(service, next)}
              toggling={togglingId === service.id}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <DeleteConfirm
          service={deleteTarget}
          deleting={deleting}
          onCancel={() => (deleting ? undefined : setDeleteTarget(null))}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

export default ServicesManager;
