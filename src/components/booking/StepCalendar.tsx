'use client';

import * as React from 'react';
import type { BookingStepProps } from '@/hooks/useBookingFlow';
import type { TimeSlot } from '@/types';
import {
  getPublicAvailability,
  type SerializedTimeSlot,
} from '@/actions/availability-public';

/**
 * StepCalendar — Step 4 of the booking flow (Calendar availability & slot
 * selection).
 *
 * On reaching this step it calls the {@link getPublicAvailability} server
 * action for the groomer's next 14 days using the estimated service duration
 * (from the selected/first service). It then renders one of:
 *  - loading skeletons while slots are being fetched (Requirement 19.3),
 *  - the available slots grouped by day with selectable time buttons sized for
 *    44px touch targets (Requirement 6.1 / 19.2),
 *  - a no-availability message suggesting the client contact the groomer
 *    directly when no slots exist (Requirement 6.5), or
 *  - a generic error with a retry action when the fetch fails.
 *
 * Selecting a slot dispatches SELECT_SLOT with the rehydrated {@link TimeSlot}
 * (advancing to payment). A Back button dispatches GO_BACK.
 *
 * Conflict handling (Requirement 6.4): the authoritative double-booking guard
 * is enforced at reservation time (task 6.7). Here, when the client selects a
 * slot we re-check availability; if that slot is no longer available (it was
 * booked by someone else since page load) we show ONLY the conflict message
 * and refresh the slot list — we do NOT simultaneously show the
 * contact-groomer / no-availability message.
 *
 * _Requirements: 6.1, 6.4, 6.5_
 */

/** A day's worth of slots, keyed by calendar date. */
interface SlotGroup {
  /** ISO date key (YYYY-MM-DD) used for grouping and React keys. */
  dateKey: string;
  /** A human-friendly heading, e.g. "Mon, Jun 3". */
  label: string;
  slots: SerializedTimeSlot[];
}

/** Discriminated UI state for the availability request. */
type CalendarUiState =
  | { status: 'loading' }
  | { status: 'ready'; slots: SerializedTimeSlot[] }
  | { status: 'error'; message: string };

/** Local-date key (YYYY-MM-DD) for grouping slots by the day they fall on. */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Heading label for a day group, e.g. "Mon, Jun 3". */
function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Time label for a slot button, e.g. "9:00 AM". */
function formatTimeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Group serialized slots by their calendar day, preserving chronological order. */
function groupSlotsByDay(slots: SerializedTimeSlot[]): SlotGroup[] {
  const groups = new Map<string, SlotGroup>();

  // Slots arrive chronologically from the engine; keep insertion order.
  for (const slot of slots) {
    const start = new Date(slot.start);
    const dateKey = toDateKey(start);
    let group = groups.get(dateKey);
    if (!group) {
      group = { dateKey, label: formatDayLabel(start), slots: [] };
      groups.set(dateKey, group);
    }
    group.slots.push(slot);
  }

  return Array.from(groups.values());
}

/** Rehydrate a transported slot into a real {@link TimeSlot} with Date fields. */
function toTimeSlot(slot: SerializedTimeSlot): TimeSlot {
  return {
    start: new Date(slot.start),
    end: new Date(slot.end),
    available: slot.available,
  };
}

/** Loading skeleton shown while slots are being fetched (Requirement 19.3). */
function CalendarSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite">
      <span className="sr-only">Loading available times…</span>
      {[0, 1].map((groupIndex) => (
        <div key={groupIndex} className="flex flex-col gap-3">
          <div className="skeleton h-5 w-32 rounded-btn" />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-11 w-full rounded-btn" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StepCalendar({ dispatch, services, groomerSlug }: BookingStepProps) {
  const [ui, setUi] = React.useState<CalendarUiState>({ status: 'loading' });
  const [conflictMessage, setConflictMessage] = React.useState<string | null>(null);
  // Guards against the effect running twice re-triggering an in-flight select.
  const [selecting, setSelecting] = React.useState(false);

  // Use the first active service's estimated duration to size the slots.
  const serviceDurationMinutes = services[0]?.durationMinutes ?? 0;

  /**
   * Fetch available slots for the next 14 days. Returns the fresh slot list on
   * success so callers (e.g. the conflict path) can re-check a selection
   * against up-to-date availability.
   */
  const fetchSlots = React.useCallback(async (): Promise<SerializedTimeSlot[]> => {
    setUi({ status: 'loading' });
    const result = await getPublicAvailability({
      groomerSlug,
      serviceDurationMinutes,
    });
    if (result.ok) {
      setUi({ status: 'ready', slots: result.slots });
      return result.slots;
    }
    setUi({ status: 'error', message: result.error });
    return [];
  }, [groomerSlug, serviceDurationMinutes]);

  React.useEffect(() => {
    let cancelled = false;
    setConflictMessage(null);
    setUi({ status: 'loading' });

    getPublicAvailability({ groomerSlug, serviceDurationMinutes })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setUi({ status: 'ready', slots: result.slots });
        } else {
          setUi({ status: 'error', message: result.error });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUi({
          status: 'error',
          message: "We couldn't load available times right now. Please try again.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [groomerSlug, serviceDurationMinutes]);

  /**
   * Handle a slot selection (Requirements 6.4 / 6.3-boundary).
   *
   * We re-fetch availability and confirm the chosen slot is still present.
   * If it is, we advance to payment via SELECT_SLOT. If it is not (conflict:
   * booked by another client since page load), we show ONLY the conflict
   * message and leave the refreshed list on screen — never alongside the
   * no-availability message.
   */
  async function handleSelect(slot: SerializedTimeSlot) {
    if (selecting) return;
    setSelecting(true);
    setConflictMessage(null);

    try {
      const freshSlots = await fetchSlots();
      const stillAvailable = freshSlots.some(
        (s) => s.start === slot.start && s.end === slot.end && s.available
      );

      if (!stillAvailable) {
        // Conflict: show ONLY the conflict message; the refreshed list is
        // already rendered by fetchSlots (Requirement 6.4).
        setConflictMessage(
          'That time was just booked by someone else and is no longer available. Please pick another time below.'
        );
        return;
      }

      dispatch({ type: 'SELECT_SLOT', payload: toTimeSlot(slot) });
    } finally {
      setSelecting(false);
    }
  }

  const groups =
    ui.status === 'ready' ? groupSlotsByDay(ui.slots) : [];
  const hasNoAvailability = ui.status === 'ready' && groups.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-base-content">Pick a time</h2>
        <p className="text-sm text-base-content/60">
          Step 4 of 5 — Available times for the next 14 days
        </p>
      </div>

      {/* Conflict message (Requirement 6.4). Shown alone; never together with
          the no-availability message below. */}
      {conflictMessage && (
        <div className="alert alert-error rounded-2xl" role="alert">
          <span>{conflictMessage}</span>
        </div>
      )}

      <div className="min-h-24">
        {ui.status === 'loading' && <CalendarSkeleton />}

        {ui.status === 'error' && (
          <div className="flex flex-col gap-3">
            <div className="alert alert-error rounded-2xl" role="alert">
              <span>{ui.message}</span>
            </div>
            <button
              type="button"
              className="btn btn-outline rounded-btn self-start"
              onClick={() => {
                setConflictMessage(null);
                void fetchSlots();
              }}
            >
              Try again
            </button>
          </div>
        )}

        {/* No-availability (Requirement 6.5). Suppressed while a conflict
            message is shown so the two never appear simultaneously. */}
        {hasNoAvailability && !conflictMessage && (
          <div className="alert rounded-2xl" role="status">
            <span>
              There are no available times in the next 14 days. Please contact
              the groomer directly to arrange an appointment.
            </span>
          </div>
        )}

        {ui.status === 'ready' && groups.length > 0 && (
          <div className="flex flex-col gap-6" aria-live="polite">
            {groups.map((group) => (
              <div key={group.dateKey} className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-base-content/80">
                  {group.label}
                </h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {group.slots.map((slot) => (
                    <button
                      key={`${slot.start}`}
                      type="button"
                      className="btn btn-outline min-h-11 h-11 rounded-btn"
                      disabled={selecting}
                      onClick={() => void handleSelect(slot)}
                    >
                      {formatTimeLabel(new Date(slot.start))}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-ghost rounded-btn"
          onClick={() => dispatch({ type: 'GO_BACK' })}
        >
          Back
        </button>
      </div>
    </div>
  );
}

export default StepCalendar;
