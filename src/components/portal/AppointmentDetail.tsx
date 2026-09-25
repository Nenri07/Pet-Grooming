'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarClock,
  Clock,
  Dog,
  MapPin,
  MapPinOff,
  Phone,
  StickyNote,
  User,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { updateAppointmentStatus } from '@/actions/appointments';
import { canTransition } from '@/lib/appointments/status';
import { LiveEtaControl } from '@/components/portal/LiveEtaControl';
import { BeforeAfterPanel } from '@/components/portal/BeforeAfterPanel';
import type { AppointmentStatus, WeightUnit } from '@/types';

/**
 * AppointmentDetail — full appointment view with status-change controls.
 *
 * The parent server component loads and serializes the appointment (scoped to
 * the groomer) and passes it here. This client component renders the client,
 * pet, and service detail, then offers ONLY the legal next-status buttons for
 * the current status, decided by the pure {@link canTransition} state machine
 * (Requirement 12.1). Marking an appointment "completed" opens an inline modal
 * that prompts for optional post-groom notes (max 2000 chars) before calling
 * the action (Requirement 12.2). On success we show a toast and refresh. Status
 * changes are immediate in Mongo and reflected in the native calendar / ICS
 * feed (Master Spec §9 — Google Calendar sync removed).
 *
 * Requirements: 12.1, 12.2, 12.4, 12.5.
 */

const MAX_POST_GROOM_NOTES = 2000;

/** Serializable appointment detail passed from the server component. */
export interface AppointmentDetailData {
  id: string;
  status: AppointmentStatus;
  /** ISO-8601 scheduled start timestamp. */
  scheduledDate: string;
  /** ISO-8601 scheduled end timestamp. */
  scheduledEndDate: string;
  serviceAddress: string | null;
  notes: string | null;
  postGroomNotes: string | null;
  client: {
    name: string | null;
    phone: string | null;
    address: string | null;
  };
  pet: {
    name: string | null;
    breed: string | null;
    weight: number | null;
    weightUnit: WeightUnit | null;
    age: number | null;
  };
  service: {
    name: string | null;
    durationMinutes: number | null;
  };
  /** Live ETA state (§11.2). */
  tracking?: {
    /** Whether a trip is currently active (started, not arrived). */
    sharing: boolean;
  };
  /** Before/After photo URLs (§11.3). */
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  /** Groomer branding for the Before/After share card (§11.3). */
  branding?: {
    business: string;
    logoUrl: string | null;
    bookingUrl: string | null;
  };
}

interface AppointmentDetailProps {
  appointment: AppointmentDetailData;
}

/** The statuses a groomer can move an appointment to, with button styling. */
const TRANSITION_TARGETS: {
  status: AppointmentStatus;
  label: string;
  btnClass: string;
}[] = [
  { status: 'in-progress', label: 'Start (in progress)', btnClass: 'btn-warning' },
  { status: 'completed', label: 'Mark completed', btnClass: 'btn-success' },
  { status: 'cancelled', label: 'Cancel appointment', btnClass: 'btn-error' },
];

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

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function mapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    address
  )}`;
}

/** A single label/value detail row. */
function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-base-content/50" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-base-content/50">
          {label}
        </p>
        <div className="text-sm text-base-content/90">{children}</div>
      </div>
    </div>
  );
}

export function AppointmentDetail({ appointment }: AppointmentDetailProps) {
  const router = useRouter();

  // Local status mirrors the server value but updates optimistically on a
  // successful transition so the controls reflect the new state immediately.
  const [status, setStatus] = React.useState<AppointmentStatus>(
    appointment.status
  );
  const [isPending, setIsPending] = React.useState(false);
  const [showNotesModal, setShowNotesModal] = React.useState(false);
  const [postGroomNotes, setPostGroomNotes] = React.useState(
    appointment.postGroomNotes ?? ''
  );

  const { client, pet, service } = appointment;

  // Only offer buttons for legal transitions from the current status (12.1).
  const availableTargets = React.useMemo(
    () => TRANSITION_TARGETS.filter((t) => canTransition(status, t.status)),
    [status]
  );

  const runTransition = React.useCallback(
    async (newStatus: AppointmentStatus, notes?: string) => {
      setIsPending(true);
      try {
        const result = await updateAppointmentStatus({
          appointmentId: appointment.id,
          newStatus,
          postGroomNotes: notes,
        });

        if (!result.ok) {
          toast.error(result.error, { duration: Infinity });
          return;
        }

        setStatus(newStatus);
        toast.success(`Appointment marked ${STATUS_LABEL[newStatus]}.`);

        setShowNotesModal(false);
        router.refresh();
      } catch {
        toast.error('Something went wrong updating the appointment.', {
          duration: Infinity,
        });
      } finally {
        setIsPending(false);
      }
    },
    [appointment.id, router]
  );

  const handleTargetClick = React.useCallback(
    (target: AppointmentStatus) => {
      // Completing prompts for optional post-groom notes first (12.2).
      if (target === 'completed') {
        setShowNotesModal(true);
        return;
      }
      void runTransition(target);
    },
    [runTransition]
  );

  const isTerminal = status === 'completed' || status === 'cancelled';

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6">
        <button
          type="button"
          onClick={() => router.push('/appointments')}
          className="btn btn-ghost btn-sm mb-3 min-h-[44px] px-0 text-base-content/60"
        >
          &larr; Back to appointments
        </button>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-base-content sm:text-3xl">
            {pet.name ?? 'Appointment'}
          </h1>
          <span
            className={cx('badge badge-lg', STATUS_BADGE[status] ?? 'badge-ghost')}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>
      </header>

      <div className="space-y-4">
        {/* Schedule + service */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-base-content">
            Schedule
          </h2>
          <div className="space-y-4">
            <DetailRow
              icon={<CalendarClock className="h-5 w-5" />}
              label="Scheduled"
            >
              {formatDateTime(appointment.scheduledDate)}
              {' – '}
              {formatTime(appointment.scheduledEndDate)}
            </DetailRow>
            <DetailRow icon={<Clock className="h-5 w-5" />} label="Service">
              {service.name ?? 'Unknown service'}
              {typeof service.durationMinutes === 'number' && (
                <span className="text-base-content/60">
                  {' '}
                  · {service.durationMinutes} min
                </span>
              )}
            </DetailRow>
            {appointment.serviceAddress ? (
              <DetailRow icon={<MapPin className="h-5 w-5" />} label="Service address">
                <p className="break-words">{appointment.serviceAddress}</p>
                <a
                  href={mapsDirectionsUrl(appointment.serviceAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex min-h-[44px] items-center font-medium text-primary underline underline-offset-2"
                >
                  Get directions
                </a>
              </DetailRow>
            ) : (
              <DetailRow
                icon={<MapPinOff className="h-5 w-5" />}
                label="Service address"
              >
                <span className="italic text-base-content/50">
                  Address unavailable
                </span>
              </DetailRow>
            )}
          </div>
        </Card>

        {/* Client */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-base-content">Client</h2>
          <div className="space-y-4">
            <DetailRow icon={<User className="h-5 w-5" />} label="Name">
              {client.name ?? 'Unknown client'}
            </DetailRow>
            <DetailRow icon={<Phone className="h-5 w-5" />} label="Phone">
              {client.phone ? (
                <a
                  href={`tel:${client.phone}`}
                  className="text-primary underline underline-offset-2"
                >
                  {client.phone}
                </a>
              ) : (
                <span className="italic text-base-content/50">Not provided</span>
              )}
            </DetailRow>
            <DetailRow icon={<MapPin className="h-5 w-5" />} label="Address">
              {client.address ?? (
                <span className="italic text-base-content/50">Not provided</span>
              )}
            </DetailRow>
          </div>
        </Card>

        {/* Pet */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-base-content">Pet</h2>
          <div className="space-y-4">
            <DetailRow icon={<Dog className="h-5 w-5" />} label="Name & breed">
              {pet.name ?? 'Unnamed pet'}
              {pet.breed && (
                <span className="text-base-content/60"> · {pet.breed}</span>
              )}
            </DetailRow>
            <div className="grid grid-cols-2 gap-4">
              <DetailRow icon={<span className="text-sm">⚖️</span>} label="Weight">
                {typeof pet.weight === 'number'
                  ? `${pet.weight} ${pet.weightUnit ?? ''}`.trim()
                  : '—'}
              </DetailRow>
              <DetailRow icon={<span className="text-sm">🎂</span>} label="Age">
                {typeof pet.age === 'number'
                  ? `${pet.age} ${pet.age === 1 ? 'year' : 'years'}`
                  : '—'}
              </DetailRow>
            </div>
          </div>
        </Card>

        {/* Notes */}
        {(appointment.notes || appointment.postGroomNotes) && (
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-base-content">Notes</h2>
            <div className="space-y-4">
              {appointment.notes && (
                <DetailRow
                  icon={<StickyNote className="h-5 w-5" />}
                  label="Booking notes"
                >
                  <p className="whitespace-pre-wrap break-words">
                    {appointment.notes}
                  </p>
                </DetailRow>
              )}
              {appointment.postGroomNotes && (
                <DetailRow
                  icon={<StickyNote className="h-5 w-5" />}
                  label="Post-groom notes"
                >
                  <p className="whitespace-pre-wrap break-words">
                    {appointment.postGroomNotes}
                  </p>
                </DetailRow>
              )}
            </div>
          </Card>
        )}

        {/* Status controls */}
        <Card>
          <h2 className="mb-1 text-lg font-semibold text-base-content">
            Update status
          </h2>
          {isTerminal ? (
            <p className="text-sm text-base-content/60">
              This appointment is {STATUS_LABEL[status].toLowerCase()} and can no
              longer change status.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-base-content/60">
                Move this appointment to its next status.
              </p>
              <div className="flex flex-wrap gap-3">
                {availableTargets.map((target) => (
                  <button
                    key={target.status}
                    type="button"
                    disabled={isPending}
                    onClick={() => handleTargetClick(target.status)}
                    className={cx('btn min-h-[44px]', target.btnClass)}
                  >
                    {target.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Live ETA (§11.2): "On my way" + Sharing banner. Hidden when the
            appointment is completed / cancelled. */}
        <LiveEtaControl
          appointmentId={appointment.id}
          initialSharing={Boolean(appointment.tracking?.sharing)}
          disabled={isTerminal}
        />

        {/* Before/After (§11.3): upload photos + generate a branded share card. */}
        <BeforeAfterPanel
          appointmentId={appointment.id}
          petName={pet.name}
          beforePhotoUrl={appointment.beforePhotoUrl ?? null}
          afterPhotoUrl={appointment.afterPhotoUrl ?? null}
          business={appointment.branding?.business ?? 'PawPort'}
          logoUrl={appointment.branding?.logoUrl ?? null}
          bookingUrl={appointment.branding?.bookingUrl ?? null}
        />
      </div>

      {/* Post-groom notes modal (12.2). Optional — completing is allowed with
          the notes left blank. */}
      {showNotesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-groom-notes-title"
        >
          <Card className="w-full max-w-md">
            <h3
              id="post-groom-notes-title"
              className="text-lg font-semibold text-base-content"
            >
              Post-groom notes
            </h3>
            <p className="mt-1 text-sm text-base-content/60">
              Add optional notes about this groom. You can leave this blank.
            </p>
            <textarea
              className="textarea textarea-bordered mt-4 min-h-[120px] w-full"
              maxLength={MAX_POST_GROOM_NOTES}
              value={postGroomNotes}
              onChange={(e) => setPostGroomNotes(e.target.value)}
              placeholder="e.g. Trimmed nails, matted areas near the ears, very cooperative."
              aria-label="Post-groom notes"
            />
            <p className="mt-1 text-right text-xs text-base-content/50">
              {postGroomNotes.length}/{MAX_POST_GROOM_NOTES}
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setShowNotesModal(false)}
                className="btn btn-ghost min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  void runTransition(
                    'completed',
                    postGroomNotes.trim() ? postGroomNotes : undefined
                  )
                }
                className="btn btn-success min-h-[44px]"
              >
                {isPending ? 'Saving…' : 'Complete appointment'}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default AppointmentDetail;
