'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { CalendarCheck, CalendarX, Plus, Trash2, Info } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import {
  updateAvailabilityWindows,
  addBlockedDate,
  removeBlockedDate,
  type AvailabilityConfig as AvailabilityConfigData,
  type AvailabilityWindowDTO,
  type BlockedDateDTO,
} from '@/actions/availability';
import {
  validateWindow,
  isEndAfterStart,
} from '@/lib/availability/validate';

/**
 * AvailabilityConfig — client editor for the Groomer Portal availability page.
 *
 * Three sections:
 *  1. Weekly recurring windows: one row group per day-of-week (Mon..Sun) with
 *     15-minute-increment start/end <select>s, add/remove per day, and a Save
 *     button that persists ALL windows at once. End <= start is flagged inline
 *     using the same pure `validateWindow` / `isEndAfterStart` helpers the
 *     server uses, and saving is blocked while any window is invalid
 *     (Requirement 14.1 / 14.6).
 *  2. Blocked dates: add a start/end via datetime-local inputs (end must be
 *     after start) and remove existing ranges (Requirement 14.4).
 *  3. Google Calendar status: because PawPort syncs via a shared service-account
 *     calendar, we show "Connected" when the calendar is configured, otherwise a
 *     notice. Sync errors are surfaced here per Requirement 14.5 (the actual
 *     sync runs in task 8.x).
 *
 * All server calls return typed envelopes; failures surface as sonner toasts.
 * Every interactive control meets the 44px minimum touch target.
 *
 * _Requirements: 14.1, 14.4, 14.5, 14.6_
 */

interface AvailabilityConfigProps {
  initialConfig: AvailabilityConfigData;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** 0 = Monday .. 6 = Sunday (matches the GroomerProfile storage convention). */
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

/** A window with a stable local id so React keys survive edits/removals. */
interface EditableWindow extends AvailabilityWindowDTO {
  localId: string;
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `w-${localIdCounter}`;
}

/** Default new-window values for a given day: 9:00 to 17:00. */
function makeDefaultWindow(dayOfWeek: number): EditableWindow {
  return { localId: nextLocalId(), dayOfWeek, startTime: '09:00', endTime: '17:00' };
}

/** Render a datetime for display in the visitor's locale. */
function formatBlockedRange(block: BlockedDateDTO): string {
  const start = new Date(block.startDateTime);
  const end = new Date(block.endDateTime);
  const fmt: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return `${start.toLocaleString(undefined, fmt)} — ${end.toLocaleString(undefined, fmt)}`;
}

// ---------------------------------------------------------------------------
// Time <select>
// ---------------------------------------------------------------------------

function TimeSelect({
  id,
  value,
  onChange,
  invalid,
  label,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  label: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      aria-invalid={invalid ? 'true' : 'false'}
      className={cx('select select-bordered min-h-[44px]', invalid && 'select-error')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {/* Ensure the current value is always selectable even if it is not a
          canonical increment (e.g. legacy data). */}
      {!TIME_OPTIONS.includes(value) && <option value={value}>{value}</option>}
      {TIME_OPTIONS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Weekly windows editor
// ---------------------------------------------------------------------------

function WeeklyWindowsEditor({
  windows,
  setWindows,
}: {
  windows: EditableWindow[];
  setWindows: React.Dispatch<React.SetStateAction<EditableWindow[]>>;
}) {
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

  // The first validation error across all windows blocks saving (Req 14.6).
  const firstError = React.useMemo(() => {
    for (const w of windows) {
      const err = validateWindow(w);
      if (err) return err;
    }
    return null;
  }, [windows]);

  const handleSave = async () => {
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
      if (result.ok) {
        // Re-key from the persisted set so the editor mirrors stored state.
        setWindows(
          result.windows.map((w) => ({ ...w, localId: nextLocalId() }))
        );
        toast.success('Availability saved.');
      } else {
        toast.error(result.error, { duration: Infinity });
      }
    } catch {
      toast.error("We couldn't save your availability. Please try again.", {
        duration: Infinity,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-base-content">Weekly hours</h2>
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
                          id={`start-${w.localId}`}
                          value={w.startTime}
                          onChange={(v) => updateField(w.localId, 'startTime', v)}
                          invalid={rangeInvalid}
                          label={`${label} start time`}
                        />
                        <span className="text-base-content/50">to</span>
                        <TimeSelect
                          id={`end-${w.localId}`}
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

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {firstError && (
          <p className="text-sm text-error sm:mr-auto" role="alert">
            {firstError}
          </p>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || Boolean(firstError)}
          className="btn btn-primary min-h-[44px]"
        >
          {saving ? (
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          ) : (
            'Save hours'
          )}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Blocked dates editor
// ---------------------------------------------------------------------------

function BlockedDatesEditor({
  blockedDates,
  setBlockedDates,
}: {
  blockedDates: BlockedDateDTO[];
  setBlockedDates: React.Dispatch<React.SetStateAction<BlockedDateDTO[]>>;
}) {
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [removingIndex, setRemovingIndex] = React.useState<number | null>(null);

  // Inline validation for the add form: both present and end after start.
  const rangeError = React.useMemo(() => {
    if (!start || !end) return null;
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      return 'Please choose a valid start and end.';
    }
    if (e.getTime() <= s.getTime()) {
      return 'End date/time must be after the start date/time.';
    }
    return null;
  }, [start, end]);

  const canAdd = Boolean(start) && Boolean(end) && !rangeError && !adding;

  const handleAdd = async () => {
    if (!canAdd) {
      if (rangeError) toast.error(rangeError);
      return;
    }
    setAdding(true);
    try {
      // datetime-local values are local wall-clock; convert to ISO instants.
      const result = await addBlockedDate({
        startDateTime: new Date(start).toISOString(),
        endDateTime: new Date(end).toISOString(),
      });
      if (result.ok) {
        setBlockedDates(result.blockedDates);
        setStart('');
        setEnd('');
        toast.success('Date blocked.');
      } else {
        toast.error(result.error, { duration: Infinity });
      }
    } catch {
      toast.error("We couldn't block that date. Please try again.", {
        duration: Infinity,
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (index: number) => {
    setRemovingIndex(index);
    try {
      const result = await removeBlockedDate(index);
      if (result.ok) {
        setBlockedDates(result.blockedDates);
        toast.success('Blocked date removed.');
      } else {
        toast.error(result.error, { duration: Infinity });
      }
    } catch {
      toast.error("We couldn't remove that blocked date. Please try again.", {
        duration: Infinity,
      });
    } finally {
      setRemovingIndex(null);
    }
  };

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-base-content">Blocked dates</h2>
        <p className="text-sm text-base-content/60">
          Block specific dates or time ranges (holidays, time off) so clients
          can&apos;t book them.
        </p>
      </div>

      {/* Add form */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="form-control">
            <label className="label" htmlFor="blocked-start">
              <span className="label-text">Start</span>
            </label>
            <input
              id="blocked-start"
              type="datetime-local"
              className={cx(
                'input input-bordered min-h-[44px] w-full',
                rangeError && 'input-error'
              )}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="form-control">
            <label className="label" htmlFor="blocked-end">
              <span className="label-text">End</span>
            </label>
            <input
              id="blocked-end"
              type="datetime-local"
              className={cx(
                'input input-bordered min-h-[44px] w-full',
                rangeError && 'input-error'
              )}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>

        {rangeError && (
          <p className="text-sm text-error" role="alert">
            {rangeError}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="btn btn-primary min-h-[44px] gap-1"
          >
            {adding ? (
              <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Block date
              </>
            )}
          </button>
        </div>
      </div>

      {/* Existing blocked dates */}
      <div className="mt-4 flex flex-col gap-2">
        {blockedDates.length === 0 ? (
          <p className="py-2 text-sm text-base-content/50">No blocked dates.</p>
        ) : (
          blockedDates.map((block, index) => (
            <div
              key={`${block.startDateTime}-${block.endDateTime}-${index}`}
              className="flex items-center justify-between gap-3 rounded-2xl bg-base-200 px-4 py-2"
            >
              <span className="text-sm text-base-content">
                {formatBlockedRange(block)}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                disabled={removingIndex === index}
                className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px] text-error"
                aria-label={`Remove blocked range ${formatBlockedRange(block)}`}
              >
                {removingIndex === index ? (
                  <span className="loading loading-spinner loading-xs" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Google Calendar status card
// ---------------------------------------------------------------------------

function GoogleCalendarStatus({ configured }: { configured: boolean }) {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        {configured ? (
          <CalendarCheck className="h-5 w-5 text-success" aria-hidden="true" />
        ) : (
          <CalendarX className="h-5 w-5 text-base-content/50" aria-hidden="true" />
        )}
        <h2 className="text-lg font-semibold text-base-content">Google Calendar</h2>
        <span
          className={cx('badge', configured ? 'badge-success' : 'badge-ghost')}
        >
          {configured ? 'Connected' : 'Not configured'}
        </span>
      </div>

      {configured ? (
        <p className="text-sm text-base-content/70">
          Bookings sync automatically to your business Google Calendar, and
          existing calendar events block those time slots from being booked.
        </p>
      ) : (
        <div
          className="alert alert-info mt-2 flex items-start gap-2 text-sm"
          role="status"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Calendar sync isn&apos;t configured yet. Once the business calendar is
            connected, bookings will sync automatically and busy times will block
            new bookings.
          </span>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function AvailabilityConfig({ initialConfig }: AvailabilityConfigProps) {
  const [windows, setWindows] = React.useState<EditableWindow[]>(() =>
    initialConfig.windows.map((w) => ({ ...w, localId: nextLocalId() }))
  );
  const [blockedDates, setBlockedDates] = React.useState<BlockedDateDTO[]>(
    initialConfig.blockedDates
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-base-content">Availability</h1>
        <p className="text-sm text-base-content/60">
          Configure your weekly hours, block off dates, and manage calendar sync.
        </p>
      </div>

      <GoogleCalendarStatus configured={initialConfig.googleCalendarConfigured} />

      <WeeklyWindowsEditor windows={windows} setWindows={setWindows} />

      <BlockedDatesEditor
        blockedDates={blockedDates}
        setBlockedDates={setBlockedDates}
      />
    </div>
  );
}

export default AvailabilityConfig;
