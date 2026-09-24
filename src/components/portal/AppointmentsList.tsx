'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, ClipboardList, User } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AppointmentStatus } from '@/types';

/**
 * AppointmentsList — the groomer's full appointment list with client-side
 * filtering by status and date range (Requirement 12.4).
 *
 * The parent server component (app/(portal)/appointments/page.tsx) loads every
 * appointment for the groomer, sorted ascending by scheduled date, and passes
 * the serialized rows here. Filtering happens entirely on the client so it is
 * instant: a status <select> plus "from"/"to" date inputs narrow the provided
 * list without a server round-trip. Clicking a row navigates to the detail
 * view.
 *
 * Requirements:
 * - 12.1: status vocabulary (upcoming, in-progress, completed, cancelled).
 * - 12.4: list sorted ascending by date with filtering by status and range.
 */

/** Serializable appointment row passed from the server component. */
export interface AppointmentListRow {
  id: string;
  petName: string | null;
  petBreed: string | null;
  clientName: string | null;
  serviceName: string | null;
  serviceAddress: string | null;
  /** ISO-8601 scheduled start timestamp. */
  scheduledDate: string;
  status: AppointmentStatus;
  notes: string | null;
}

interface AppointmentsListProps {
  appointments: AppointmentListRow[];
}

/** Selectable status filter values ('all' clears the status filter). */
type StatusFilter = AppointmentStatus | 'all';

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** DaisyUI badge classes giving each status a visually distinct label. */
const STATUS_BADGE: Record<AppointmentStatus, string> = {
  upcoming: 'badge-info',
  'in-progress': 'badge-warning',
  completed: 'badge-success',
  cancelled: 'badge-error',
};

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Format an ISO timestamp as a friendly local date + time. */
function formatScheduled(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Parse a `yyyy-mm-dd` date input into a Date at the start of that local day.
 * Returns null for empty/invalid values so an unset bound imposes no filter.
 */
function startOfLocalDay(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Parse a `yyyy-mm-dd` date input into a Date at the end of that local day
 * (inclusive upper bound). Returns null for empty/invalid values.
 */
function endOfLocalDay(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={cx('badge', STATUS_BADGE[status] ?? 'badge-ghost')}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function AppointmentRow({
  appointment,
  onOpen,
}: {
  appointment: AppointmentListRow;
  onOpen: (id: string) => void;
}) {
  const { id, petName, petBreed, clientName, serviceName, scheduledDate, status } =
    appointment;

  return (
    <Card
      interactive
      role="button"
      tabIndex={0}
      aria-label={`Open appointment for ${petName ?? 'pet'}`}
      onClick={() => onOpen(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(id);
        }
      }}
      className="min-h-[44px] cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-base-content">
            {petName ?? 'Unnamed pet'}
            {petBreed && (
              <span className="ml-2 text-sm font-normal text-base-content/50">
                {petBreed}
              </span>
            )}
          </h3>
          {serviceName && (
            <p className="truncate text-sm text-base-content/60">
              {serviceName}
            </p>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-3 space-y-2">
        <p className="flex items-center gap-2 text-sm text-base-content/80">
          <User
            className="h-4 w-4 shrink-0 text-base-content/50"
            aria-hidden="true"
          />
          <span className="truncate">{clientName ?? 'Unknown client'}</span>
        </p>
        <p className="flex items-center gap-2 text-sm text-base-content/80">
          <CalendarClock
            className="h-4 w-4 shrink-0 text-base-content/50"
            aria-hidden="true"
          />
          <span>{formatScheduled(scheduledDate)}</span>
        </p>
      </div>
    </Card>
  );
}

export function AppointmentsList({ appointments }: AppointmentsListProps) {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [fromValue, setFromValue] = React.useState('');
  const [toValue, setToValue] = React.useState('');

  const handleOpen = React.useCallback(
    (id: string) => {
      router.push(`/appointments/${id}`);
    },
    [router]
  );

  // Apply the status + date-range filters to the provided (already
  // date-ascending) list. Filtering is memoized so it only recomputes when a
  // filter value or the source list changes.
  const filtered = React.useMemo(() => {
    const from = startOfLocalDay(fromValue);
    const to = endOfLocalDay(toValue);

    return appointments.filter((appt) => {
      if (statusFilter !== 'all' && appt.status !== statusFilter) {
        return false;
      }
      const when = new Date(appt.scheduledDate).getTime();
      if (from && when < from.getTime()) return false;
      if (to && when > to.getTime()) return false;
      return true;
    });
  }, [appointments, statusFilter, fromValue, toValue]);

  const hasActiveFilter =
    statusFilter !== 'all' || fromValue !== '' || toValue !== '';

  const clearFilters = React.useCallback(() => {
    setStatusFilter('all');
    setFromValue('');
    setToValue('');
  }, []);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-base-content sm:text-3xl">
          Appointments
        </h1>
        <p className="mt-1 text-base-content/60">
          All appointments, earliest first. Filter by status or date range.
        </p>
      </header>

      {/* Filter controls (Req 12.4). */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="form-control w-full">
            <span className="label-text mb-1 text-sm font-medium">Status</span>
            <select
              className="select select-bordered min-h-[44px] w-full"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filter by status"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-control w-full">
            <span className="label-text mb-1 text-sm font-medium">From</span>
            <input
              type="date"
              className="input input-bordered min-h-[44px] w-full"
              value={fromValue}
              max={toValue || undefined}
              onChange={(e) => setFromValue(e.target.value)}
              aria-label="Filter from date"
            />
          </label>

          <label className="form-control w-full">
            <span className="label-text mb-1 text-sm font-medium">To</span>
            <input
              type="date"
              className="input input-bordered min-h-[44px] w-full"
              value={toValue}
              min={fromValue || undefined}
              onChange={(e) => setToValue(e.target.value)}
              aria-label="Filter to date"
            />
          </label>
        </div>

        {hasActiveFilter && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-base-content/60">
              Showing {filtered.length} of {appointments.length}
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="btn btn-ghost btn-sm min-h-[44px]"
            >
              Clear filters
            </button>
          </div>
        )}
      </Card>

      {appointments.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-10 w-10" aria-hidden="true" />}
          title="No appointments yet"
          description="Appointments will appear here as clients book with you."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-10 w-10" aria-hidden="true" />}
          title="No matching appointments"
          description="No appointments match the current filters. Try widening the date range or clearing the status filter."
          action={{ label: 'Clear filters', onClick: clearFilters }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              onOpen={handleOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default AppointmentsList;
