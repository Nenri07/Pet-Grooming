'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, MapPin, MapPinOff, User } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AppointmentStatus } from '@/types';

/**
 * DashboardView — renders the groomer's upcoming appointments (today + next 7
 * days) as tappable cards, or a friendly empty state when there are none.
 *
 * The parent server component (app/(portal)/dashboard/page.tsx) fetches and
 * serializes the appointments, passing plain JSON here (this is a client
 * component so it can handle click-to-navigate and the "view full notes"
 * affordance).
 *
 * Requirements:
 * - 9.2: show pet name, client name, service address, scheduled time, key
 *   notes truncated to 100 chars (with view-full affordance), status, and a
 *   Google Maps directions link; WHERE no appointments are displayed, hide the
 *   appointment detail fields entirely.
 * - 9.3: clicking an appointment navigates to its detail view.
 * - 9.4: visually distinct status labels per state.
 * - 9.5: empty state message when no appointments exist.
 * - 9.6: omit the Maps link and show "address unavailable" when no address.
 */

/** Serializable appointment shape passed from the server component. */
export interface DashboardAppointment {
  id: string;
  petName: string | null;
  clientName: string | null;
  serviceName: string | null;
  serviceAddress: string | null;
  /** ISO-8601 scheduled start timestamp. */
  scheduledDate: string;
  status: AppointmentStatus;
  notes: string | null;
}

interface DashboardViewProps {
  appointments: DashboardAppointment[];
}

const NOTES_TRUNCATE_LENGTH = 100;

/** DaisyUI badge classes giving each status a visually distinct label (9.4). */
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

/** Build a Google Maps directions URL for a service address (9.2, 9.6). */
function mapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    address
  )}`;
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={cx('badge', STATUS_BADGE[status] ?? 'badge-ghost')}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Notes with a truncate-to-100-chars + "view full" toggle (9.2). */
function AppointmentNotes({ notes }: { notes: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const isLong = notes.length > NOTES_TRUNCATE_LENGTH;
  const shown =
    expanded || !isLong ? notes : `${notes.slice(0, NOTES_TRUNCATE_LENGTH)}…`;

  return (
    <p className="text-sm text-base-content/70">
      {shown}
      {isLong && (
        <button
          type="button"
          onClick={(e) => {
            // Prevent the parent card's navigation click.
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="ml-1 font-medium text-primary underline underline-offset-2"
        >
          {expanded ? 'View less' : 'View full'}
        </button>
      )}
    </p>
  );
}

function AppointmentCard({
  appointment,
  onOpen,
}: {
  appointment: DashboardAppointment;
  onOpen: (id: string) => void;
}) {
  const {
    id,
    petName,
    clientName,
    serviceName,
    serviceAddress,
    scheduledDate,
    status,
    notes,
  } = appointment;

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
      className="cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-base-content">
            {petName ?? 'Unnamed pet'}
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
          <User className="h-4 w-4 shrink-0 text-base-content/50" aria-hidden="true" />
          <span className="truncate">{clientName ?? 'Unknown client'}</span>
        </p>

        <p className="flex items-center gap-2 text-sm text-base-content/80">
          <CalendarClock
            className="h-4 w-4 shrink-0 text-base-content/50"
            aria-hidden="true"
          />
          <span>{formatScheduled(scheduledDate)}</span>
        </p>

        {serviceAddress ? (
          <div className="flex items-start gap-2 text-sm text-base-content/80">
            <MapPin
              className="mt-0.5 h-4 w-4 shrink-0 text-base-content/50"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="break-words">{serviceAddress}</p>
              <a
                href={mapsDirectionsUrl(serviceAddress)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-1 inline-flex min-h-[44px] items-center font-medium text-primary underline underline-offset-2"
              >
                Get directions
              </a>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm italic text-base-content/50">
            <MapPinOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Address unavailable</span>
          </p>
        )}

        {notes && <AppointmentNotes notes={notes} />}
      </div>
    </Card>
  );
}

export function DashboardView({ appointments }: DashboardViewProps) {
  const router = useRouter();
  const handleOpen = React.useCallback(
    (id: string) => {
      router.push(`/appointments/${id}`);
    },
    [router]
  );

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-base-content sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-1 text-base-content/60">
          Today and the next 7 days at a glance.
        </p>
      </header>

      {/* WHERE no appointments are displayed, hide the detail fields entirely
          and show a friendly empty state (9.2 clarification, 9.5). */}
      {appointments.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-10 w-10" aria-hidden="true" />}
          title="No upcoming appointments"
          description="You have no appointments scheduled for today or the next 7 days. New bookings will appear here automatically."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {appointments.map((appointment) => (
            <AppointmentCard
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

export default DashboardView;
