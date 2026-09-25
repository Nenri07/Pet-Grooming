'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Columns3,
  Map as MapIcon,
  Plus,
  X,
  Navigation,
  ExternalLink,
} from 'lucide-react';
import {
  SLOT_STEP_MIN,
  DAY_START_HOUR,
  DAY_END_HOUR,
  VISIBLE_MINUTES,
  MS_PER_MINUTE,
  minutesFromDayStart,
  durationMinutes,
  pixelsToSnappedMinutes,
  shiftBlock,
  resizeBlockEnd,
  snapToStep,
  localDayKey,
} from '@/lib/calendar/grid';
import {
  rescheduleAppointment,
  createManualAppointment,
  getManualBookingOptions,
  type ManualBookingClient,
  type ManualBookingService,
} from '@/actions/appointments';
import type { AppointmentStatus } from '@/types';

/**
 * CalendarView — the portal calendar (Master Spec §9.6).
 *
 * - Day view (default on mobile): a vertical timeline for the selected day with
 *   status-colored blocks, a current-time line, travel chips between
 *   consecutive stops, and tap-empty-space → Add booking / Block time.
 * - Week view (default on desktop): 7 day columns on a 15-min grid. Blocks are
 *   drag-to-move and resize-to-change-duration (@dnd-kit). On drop the time
 *   snaps to the grid and calls `rescheduleAppointment`; a conflict result
 *   SNAPS the block back and shows an error toast.
 * - View toggle + prev/next/today navigation, status & service filters, and a
 *   Map toggle that reveals a numbered stop list ("Route map — coming soon").
 * - A small "Subscribe in your calendar" hint links to /availability where the
 *   ICS feed lives.
 *
 * Portal = calm and fast: theme tokens only (no color literals), 44px+ targets,
 * subtle Framer motion ≤300ms. Drag degrades to tap-to-open on touch (an
 * activation distance prevents accidental drags).
 *
 * _Master Spec: §9.6_
 */

// ---------------------------------------------------------------------------
// Serializable prop shapes (from the server page).
// ---------------------------------------------------------------------------

export interface CalendarAppointment {
  id: string;
  petName: string | null;
  petBreed: string | null;
  clientName: string | null;
  serviceName: string | null;
  serviceId: string | null;
  serviceAddress: string | null;
  startMs: number;
  endMs: number;
  status: AppointmentStatus;
  lat: number | null;
  lng: number | null;
  extraDriveMin: number | null;
  fromPrevKm: number | null;
}

export interface CalendarProfile {
  windows: { dayOfWeek: number; startTime: string; endTime: string }[];
  bufferMin: number;
  timezone: string;
  feedUrl: string | null;
}

interface CalendarViewProps {
  appointments: CalendarAppointment[];
  profile: CalendarProfile;
}

type ViewMode = 'day' | 'week';

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Status → daisyUI/theme token classes for the block surface. */
function statusClasses(status: AppointmentStatus): string {
  switch (status) {
    case 'in-progress':
      return 'bg-warning/20 border-warning text-warning-content';
    case 'completed':
      return 'bg-success/20 border-success text-success-content';
    case 'cancelled':
      return 'bg-error/15 border-error/50 text-base-content/50 line-through';
    case 'upcoming':
    default:
      return 'bg-info/20 border-info text-info-content';
  }
}

/** Status → small badge token for legends/filters. */
function statusBadge(status: AppointmentStatus): string {
  switch (status) {
    case 'in-progress':
      return 'badge-warning';
    case 'completed':
      return 'badge-success';
    case 'cancelled':
      return 'badge-error';
    case 'upcoming':
    default:
      return 'badge-info';
  }
}

const STATUS_OPTIONS: AppointmentStatus[] = [
  'upcoming',
  'in-progress',
  'completed',
  'cancelled',
];

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday-anchored start of the week containing `d` (0 = Monday convention). */
function startOfWeek(d: Date): Date {
  const x = startOfLocalDay(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}

// ---------------------------------------------------------------------------
// Layout constants: pixels per minute for the vertical grid.
// ---------------------------------------------------------------------------

const PX_PER_MIN_DAY = 1.1; // taller, touch-friendly day timeline
const PX_PER_MIN_WEEK = 0.7; // compact week columns
const HOUR_LINES = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i
);

// ===========================================================================
// Root component
// ===========================================================================

export function CalendarView({ appointments, profile }: CalendarViewProps) {
  const router = useRouter();

  // Responsive default: Day on mobile, Week on desktop.
  const [view, setView] = React.useState<ViewMode>('day');
  const [initialisedView, setInitialisedView] = React.useState(false);
  React.useEffect(() => {
    if (initialisedView) return;
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    setView(isDesktop ? 'week' : 'day');
    setInitialisedView(true);
  }, [initialisedView]);

  const [anchor, setAnchor] = React.useState<Date>(() => startOfLocalDay(new Date()));
  const [showMap, setShowMap] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [addPrefill, setAddPrefill] = React.useState<{ startMs: number } | null>(null);

  // Filters (client-side).
  const [statusFilter, setStatusFilter] = React.useState<AppointmentStatus | 'all'>('all');
  const [serviceFilter, setServiceFilter] = React.useState<string>('all');

  // Local optimistic override of times (so a successful reschedule reflects
  // immediately without a full reload; the server also revalidates).
  const [overrides, setOverrides] = React.useState<
    Record<string, { startMs: number; endMs: number }>
  >({});

  const resolved: CalendarAppointment[] = React.useMemo(
    () =>
      appointments.map((a) =>
        overrides[a.id] ? { ...a, ...overrides[a.id] } : a
      ),
    [appointments, overrides]
  );

  const serviceOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of appointments) {
      if (a.serviceId && a.serviceName && !seen.has(a.serviceId)) {
        seen.set(a.serviceId, a.serviceName);
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [appointments]);

  const filtered = React.useMemo(
    () =>
      resolved.filter((a) => {
        if (statusFilter !== 'all' && a.status !== statusFilter) return false;
        if (serviceFilter !== 'all' && a.serviceId !== serviceFilter) return false;
        return true;
      }),
    [resolved, statusFilter, serviceFilter]
  );

  const goToday = () => setAnchor(startOfLocalDay(new Date()));
  const step = (dir: number) => {
    setAnchor((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + (view === 'day' ? dir : dir * 7));
      return next;
    });
  };

  // Shared reschedule handler used by both drag-move and resize. Returns
  // whether the move committed (false → caller snaps back).
  const commitReschedule = React.useCallback(
    async (id: string, newStartMs: number, newEndMs: number): Promise<boolean> => {
      // Optimistically apply, then reconcile with the server.
      setOverrides((prev) => ({ ...prev, [id]: { startMs: newStartMs, endMs: newEndMs } }));
      const result = await rescheduleAppointment({
        appointmentId: id,
        newStartMs,
        newEndMs,
      });
      if (result.ok) {
        toast.success('Appointment moved.');
        router.refresh();
        return true;
      }
      // Snap back: drop the optimistic override.
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if ('reason' in result && result.reason === 'conflict') {
        toast.error('That time overlaps another appointment. Snapped back.', {
          duration: Infinity,
        });
      } else {
        toast.error(
          'error' in result ? result.error : "Couldn't move the appointment.",
          { duration: Infinity }
        );
      }
      return false;
    },
    [router]
  );

  const openAddAt = (startMs: number) => {
    setAddPrefill({ startMs: snapToStep(startMs) });
    setAddOpen(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-24 md:pb-6">
      <CalendarHeader
        view={view}
        setView={setView}
        anchor={anchor}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={goToday}
        showMap={showMap}
        onToggleMap={() => setShowMap((s) => !s)}
        onAdd={() => openAddAt(defaultSlotStart(anchor))}
      />

      <FilterBar
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        serviceFilter={serviceFilter}
        setServiceFilter={setServiceFilter}
        serviceOptions={serviceOptions}
      />

      <IcsHint feedUrl={profile.feedUrl} />

      {showMap && <MapPanel dayKey={localDayKey(anchor.getTime())} appointments={filtered} anchor={anchor} view={view} />}

      {view === 'day' ? (
        <DayView
          anchor={anchor}
          appointments={filtered}
          onEmptyTap={openAddAt}
          onOpen={(id) => router.push(`/appointments/${id}`)}
        />
      ) : (
        <WeekView
          anchor={anchor}
          appointments={filtered}
          onOpen={(id) => router.push(`/appointments/${id}`)}
          onEmptyTap={openAddAt}
          commitReschedule={commitReschedule}
        />
      )}

      <AnimatePresence>
        {addOpen && (
          <AddBookingModal
            key="add-modal"
            prefillStartMs={addPrefill?.startMs ?? defaultSlotStart(anchor)}
            onClose={() => setAddOpen(false)}
            onCreated={() => {
              setAddOpen(false);
              router.refresh();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** A sensible default start (next hour boundary on the anchored day). */
function defaultSlotStart(anchor: Date): number {
  const d = startOfLocalDay(anchor);
  const now = new Date();
  const hour = anchor.toDateString() === now.toDateString() ? now.getHours() + 1 : 10;
  d.setHours(Math.min(Math.max(hour, DAY_START_HOUR), DAY_END_HOUR - 1), 0, 0, 0);
  return d.getTime();
}

// ===========================================================================
// Header: view toggle + date nav + map/add
// ===========================================================================

function CalendarHeader({
  view,
  setView,
  anchor,
  onPrev,
  onNext,
  onToday,
  showMap,
  onToggleMap,
  onAdd,
}: {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  anchor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  showMap: boolean;
  onToggleMap: () => void;
  onAdd: () => void;
}) {
  const label =
    view === 'day'
      ? fmtDayLabel(anchor)
      : (() => {
          const s = startOfWeek(anchor);
          const e = new Date(s);
          e.setDate(e.getDate() + 6);
          return `${fmtDayLabel(s)} – ${fmtDayLabel(e)}`;
        })();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-base-content">Calendar</h1>
        <div className="flex items-center gap-2">
          <div className="join" role="group" aria-label="Calendar view">
            <button
              type="button"
              onClick={() => setView('day')}
              aria-pressed={view === 'day'}
              className={cx(
                'btn join-item min-h-[44px] gap-1',
                view === 'day' ? 'btn-primary' : 'btn-ghost bg-base-200'
              )}
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Day
            </button>
            <button
              type="button"
              onClick={() => setView('week')}
              aria-pressed={view === 'week'}
              className={cx(
                'btn join-item min-h-[44px] gap-1',
                view === 'week' ? 'btn-primary' : 'btn-ghost bg-base-200'
              )}
            >
              <Columns3 className="h-4 w-4" aria-hidden="true" />
              Week
            </button>
          </div>
          <button
            type="button"
            onClick={onToggleMap}
            aria-pressed={showMap}
            className={cx(
              'btn min-h-[44px] gap-1',
              showMap ? 'btn-primary' : 'btn-ghost bg-base-200'
            )}
            aria-label="Toggle route map"
          >
            <MapIcon className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Map</span>
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="btn btn-primary min-h-[44px] gap-1"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Add booking</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous"
          className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px] bg-base-200"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next"
          className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px] bg-base-200"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="btn btn-ghost min-h-[44px] bg-base-200"
        >
          Today
        </button>
        <span className="ml-1 text-sm font-medium text-base-content/80">{label}</span>
      </div>
    </div>
  );
}

// ===========================================================================
// Filters
// ===========================================================================

function FilterBar({
  statusFilter,
  setStatusFilter,
  serviceFilter,
  setServiceFilter,
  serviceOptions,
}: {
  statusFilter: AppointmentStatus | 'all';
  setStatusFilter: (s: AppointmentStatus | 'all') => void;
  serviceFilter: string;
  setServiceFilter: (s: string) => void;
  serviceOptions: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-box border border-base-content/10 bg-base-100 p-3 shadow-card">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-base-content/70">Status</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AppointmentStatus | 'all')}
          className="select select-bordered select-sm min-h-[44px] border-base-content/10 bg-base-200"
          aria-label="Filter by status"
        >
          <option value="all">All</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-base-content/70">Service</span>
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="select select-bordered select-sm min-h-[44px] border-base-content/10 bg-base-200"
          aria-label="Filter by service"
        >
          <option value="all">All</option>
          {serviceOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
        {STATUS_OPTIONS.map((s) => (
          <span key={s} className={cx('badge badge-sm', statusBadge(s))}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// ICS hint
// ===========================================================================

function IcsHint({ feedUrl }: { feedUrl: string | null }) {
  return (
    <a
      href="/availability"
      className="flex items-center gap-2 rounded-box border border-base-content/10 bg-base-200 px-3 py-2 text-sm text-base-content/80 transition-colors hover:bg-base-300"
    >
      <ExternalLink className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      {feedUrl
        ? 'Subscribe to this calendar in Apple, Google, or Outlook — manage the feed on your Availability page.'
        : 'Subscribe to this calendar in Apple, Google, or Outlook — set up the feed on your Availability page.'}
    </a>
  );
}

// ===========================================================================
// Day view
// ===========================================================================

function TimeAxis({ pxPerMin }: { pxPerMin: number }) {
  return (
    <div className="relative w-14 shrink-0" style={{ height: VISIBLE_MINUTES * pxPerMin }}>
      {HOUR_LINES.map((h) => (
        <div
          key={h}
          className="absolute right-1 -translate-y-1/2 text-[11px] text-base-content/50"
          style={{ top: (h - DAY_START_HOUR) * 60 * pxPerMin }}
        >
          {h % 12 === 0 ? 12 : h % 12}
          {h < 12 ? 'a' : 'p'}
        </div>
      ))}
    </div>
  );
}

function GridLines({ pxPerMin }: { pxPerMin: number }) {
  return (
    <>
      {HOUR_LINES.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute inset-x-0 border-t border-base-content/10"
          style={{ top: (h - DAY_START_HOUR) * 60 * pxPerMin }}
        />
      ))}
    </>
  );
}

function CurrentTimeLine({ pxPerMin, day }: { pxPerMin: number; day: Date }) {
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  const isToday = new Date(now).toDateString() === day.toDateString();
  if (!isToday) return null;
  const mins = minutesFromDayStart(now);
  if (mins < 0 || mins > VISIBLE_MINUTES) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
      style={{ top: mins * pxPerMin }}
      aria-hidden="true"
    >
      <span className="h-2 w-2 rounded-full bg-error" />
      <div className="h-px flex-1 bg-error" />
    </div>
  );
}

function DayView({
  anchor,
  appointments,
  onEmptyTap,
  onOpen,
}: {
  anchor: Date;
  appointments: CalendarAppointment[];
  onEmptyTap: (startMs: number) => void;
  onOpen: (id: string) => void;
}) {
  const pxPerMin = PX_PER_MIN_DAY;
  const dayKey = localDayKey(anchor.getTime());
  const dayStart = startOfLocalDay(anchor);

  const dayAppts = React.useMemo(
    () =>
      appointments
        .filter((a) => localDayKey(a.startMs) === dayKey)
        .sort((a, b) => a.startMs - b.startMs),
    [appointments, dayKey]
  );

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only when clicking empty space (not a block).
    if ((e.target as HTMLElement).closest('[data-block]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const mins = y / pxPerMin;
    const startMs = dayStart.getTime() + (DAY_START_HOUR * 60 + mins) * MS_PER_MINUTE;
    onEmptyTap(startMs);
  };

  return (
    <div className="rounded-box border border-base-content/10 bg-base-100 p-2 shadow-card sm:p-4">
      <div className="flex">
        <TimeAxis pxPerMin={pxPerMin} />
        <div
          className="relative flex-1 rounded-box bg-base-200/40"
          style={{ height: VISIBLE_MINUTES * pxPerMin }}
          onClick={handleColumnClick}
          role="button"
          tabIndex={0}
          aria-label="Day timeline — tap empty space to add a booking"
        >
          <GridLines pxPerMin={pxPerMin} />
          <CurrentTimeLine pxPerMin={pxPerMin} day={anchor} />

          {dayAppts.map((a, idx) => {
            const top = Math.max(0, minutesFromDayStart(a.startMs)) * pxPerMin;
            const height = Math.max(
              SLOT_STEP_MIN * pxPerMin,
              durationMinutes(a.startMs, a.endMs) * pxPerMin
            );
            const prev = idx > 0 ? dayAppts[idx - 1] : null;
            return (
              <React.Fragment key={a.id}>
                {prev && <TravelChip prev={prev} curr={a} pxPerMin={pxPerMin} />}
                <motion.button
                  type="button"
                  data-block
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.2) }}
                  onClick={() => onOpen(a.id)}
                  className={cx(
                    'absolute left-2 right-2 z-10 overflow-hidden rounded-box border-l-4 px-2 py-1 text-left text-xs shadow-card transition-transform hover:scale-[1.01]',
                    statusClasses(a.status)
                  )}
                  style={{ top, height }}
                  aria-label={`${a.petName ?? 'Appointment'} at ${fmtTime(a.startMs)}`}
                >
                  <span className="block truncate font-semibold">
                    {a.petName ?? 'Appointment'}
                    {a.petBreed ? ` · ${a.petBreed}` : ''}
                  </span>
                  <span className="block truncate opacity-80">
                    {fmtTime(a.startMs)}–{fmtTime(a.endMs)}
                    {a.serviceName ? ` · ${a.serviceName}` : ''}
                  </span>
                  {a.clientName && (
                    <span className="block truncate opacity-70">{a.clientName}</span>
                  )}
                </motion.button>
              </React.Fragment>
            );
          })}

          {dayAppts.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-base-content/50">
              No appointments. Tap anywhere to add a booking or block time.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Travel chip between two consecutive stops (routeMeta or haversine; else omitted). */
function TravelChip({
  prev,
  curr,
  pxPerMin,
}: {
  prev: CalendarAppointment;
  curr: CalendarAppointment;
  pxPerMin: number;
}) {
  // Prefer stored routeMeta on the current stop; else derive from coords.
  let minutes: number | null =
    typeof curr.extraDriveMin === 'number' ? Math.round(curr.extraDriveMin) : null;
  let km: number | null = typeof curr.fromPrevKm === 'number' ? curr.fromPrevKm : null;

  if (minutes === null && km === null) {
    if (
      prev.lat !== null &&
      prev.lng !== null &&
      curr.lat !== null &&
      curr.lng !== null
    ) {
      km = haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
      // Rough drive estimate: 32 km/h + road factor 1.35 (matches routing defaults).
      minutes = Math.round((km * 1.35) / 32 * 60);
    }
  }

  if (minutes === null && km === null) return null;

  const top = Math.max(0, minutesFromDayStart(curr.startMs)) * pxPerMin - 10;
  return (
    <div
      className="absolute left-2 z-20 flex items-center gap-1 rounded-full border border-base-content/10 bg-base-100 px-2 py-0.5 text-[10px] text-base-content/70 shadow-card"
      style={{ top }}
      aria-hidden="true"
    >
      <Navigation className="h-3 w-3 text-primary" aria-hidden="true" />
      {km !== null ? `${km.toFixed(1)} km` : null}
      {km !== null && minutes !== null ? ' · ' : null}
      {minutes !== null ? `${minutes} min drive` : null}
    </div>
  );
}

/** Inline haversine (km) — mirrors lib/routing/geo but avoids a server import. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ===========================================================================
// Week view (drag + resize)
// ===========================================================================

function WeekView({
  anchor,
  appointments,
  onOpen,
  onEmptyTap,
  commitReschedule,
}: {
  anchor: Date;
  appointments: CalendarAppointment[];
  onOpen: (id: string) => void;
  onEmptyTap: (startMs: number) => void;
  commitReschedule: (id: string, startMs: number, endMs: number) => Promise<boolean>;
}) {
  const pxPerMin = PX_PER_MIN_WEEK;
  const weekStart = startOfWeek(anchor);
  const days = React.useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart]
  );

  const sensors = useSensors(
    // Require a small drag distance so a tap opens the appointment instead of
    // starting an accidental drag (touch-friendly).
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  // Live drag feedback: minute delta + kind (move|resize) for the active block.
  const [activeDrag, setActiveDrag] = React.useState<{
    id: string;
    kind: 'move' | 'resize';
    deltaMin: number;
  } | null>(null);

  const byDay = React.useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>();
    for (const a of appointments) {
      const key = localDayKey(a.startMs);
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    return map;
  }, [appointments]);

  const handleDragMove = (e: DragMoveEvent) => {
    const data = e.active.data.current as
      | { id: string; kind: 'move' | 'resize' }
      | undefined;
    if (!data) return;
    const deltaMin = pixelsToSnappedMinutes(e.delta.y, pxPerMin, SLOT_STEP_MIN);
    setActiveDrag({ id: data.id, kind: data.kind, deltaMin });
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const data = e.active.data.current as
      | { id: string; kind: 'move' | 'resize'; startMs: number; endMs: number }
      | undefined;
    setActiveDrag(null);
    if (!data) return;
    const deltaMin = pixelsToSnappedMinutes(e.delta.y, pxPerMin, SLOT_STEP_MIN);
    if (deltaMin === 0) return;

    const moved =
      data.kind === 'move'
        ? shiftBlock(data.startMs, data.endMs, deltaMin)
        : resizeBlockEnd(data.startMs, data.endMs, deltaMin, SLOT_STEP_MIN);

    await commitReschedule(data.id, moved.startMs, moved.endMs);
  };

  const handleColumnClick =
    (day: Date) => (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-block]')) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const mins = y / pxPerMin;
      const base = startOfLocalDay(day);
      const startMs = base.getTime() + (DAY_START_HOUR * 60 + mins) * MS_PER_MINUTE;
      onEmptyTap(startMs);
    };

  return (
    <div className="overflow-x-auto rounded-box border border-base-content/10 bg-base-100 p-2 shadow-card">
      <DndContext
        sensors={sensors}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="flex min-w-[720px]">
          <TimeAxis pxPerMin={pxPerMin} />
          <div className="grid flex-1 grid-cols-7 gap-1">
            {days.map((day) => {
              const key = localDayKey(day.getTime());
              const dayAppts = (byDay.get(key) ?? []).sort((a, b) => a.startMs - b.startMs);
              const isToday = day.toDateString() === new Date().toDateString();
              return (
                <div key={key} className="flex flex-col">
                  <div
                    className={cx(
                      'mb-1 rounded-btn py-1 text-center text-xs font-semibold',
                      isToday ? 'bg-primary text-primary-content' : 'text-base-content/70'
                    )}
                  >
                    {day.toLocaleDateString([], { weekday: 'short' })}{' '}
                    {day.getDate()}
                  </div>
                  <div
                    className="relative rounded-box bg-base-200/40"
                    style={{ height: VISIBLE_MINUTES * pxPerMin }}
                    onClick={handleColumnClick(day)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${fmtDayLabel(day)} — tap empty space to add a booking`}
                  >
                    <GridLines pxPerMin={pxPerMin} />
                    <CurrentTimeLine pxPerMin={pxPerMin} day={day} />
                    {dayAppts.map((a) => (
                      <WeekBlock
                        key={a.id}
                        appt={a}
                        pxPerMin={pxPerMin}
                        onOpen={onOpen}
                        activeDrag={activeDrag && activeDrag.id === a.id ? activeDrag : null}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

/** A draggable + resizable appointment block in the week grid. */
function WeekBlock({
  appt,
  pxPerMin,
  onOpen,
  activeDrag,
}: {
  appt: CalendarAppointment;
  pxPerMin: number;
  onOpen: (id: string) => void;
  activeDrag: { kind: 'move' | 'resize'; deltaMin: number } | null;
}) {
  const draggable = appt.status !== 'cancelled';

  const move = useDraggable({
    id: `move-${appt.id}`,
    data: { id: appt.id, kind: 'move', startMs: appt.startMs, endMs: appt.endMs },
    disabled: !draggable,
  });
  const resize = useDraggable({
    id: `resize-${appt.id}`,
    data: { id: appt.id, kind: 'resize', startMs: appt.startMs, endMs: appt.endMs },
    disabled: !draggable,
  });

  const baseTop = Math.max(0, minutesFromDayStart(appt.startMs)) * pxPerMin;
  const baseHeight = Math.max(
    SLOT_STEP_MIN * pxPerMin,
    durationMinutes(appt.startMs, appt.endMs) * pxPerMin
  );

  // Apply live drag feedback (visual only; committed on drop).
  let top = baseTop;
  let height = baseHeight;
  if (activeDrag) {
    if (activeDrag.kind === 'move') {
      top = baseTop + activeDrag.deltaMin * pxPerMin;
    } else {
      height = Math.max(SLOT_STEP_MIN * pxPerMin, baseHeight + activeDrag.deltaMin * pxPerMin);
    }
  }

  return (
    <div
      ref={move.setNodeRef}
      data-block
      className={cx(
        'absolute left-0.5 right-0.5 z-10 select-none overflow-hidden rounded-btn border-l-4 text-[10px] shadow-card',
        statusClasses(appt.status),
        activeDrag ? 'opacity-90 ring-2 ring-primary' : ''
      )}
      style={{ top, height, touchAction: 'none' }}
    >
      <button
        type="button"
        onClick={() => onOpen(appt.id)}
        className="block w-full px-1 py-0.5 text-left"
        aria-label={`Open ${appt.petName ?? 'appointment'} at ${fmtTime(appt.startMs)}`}
      >
        <span className="block truncate font-semibold">
          {appt.petName ?? 'Appt'}
        </span>
        <span className="block truncate opacity-80">{fmtTime(appt.startMs)}</span>
      </button>

      {draggable && (
        <>
          {/* Drag-to-move handle covers the body (except the button captures taps). */}
          <div
            {...move.listeners}
            {...move.attributes}
            role="button"
            tabIndex={0}
            aria-label={`Drag to move ${appt.petName ?? 'appointment'}`}
            className="absolute inset-x-0 top-0 h-2 cursor-grab"
            title="Drag to move"
          />
          {/* Resize handle at the bottom edge. */}
          <div
            ref={resize.setNodeRef}
            {...resize.listeners}
            {...resize.attributes}
            role="button"
            tabIndex={0}
            aria-label={`Drag to change duration of ${appt.petName ?? 'appointment'}`}
            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-base-content/10"
            title="Drag to resize"
          />
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Map panel (placeholder — Mapbox is a later phase)
// ===========================================================================

function MapPanel({
  dayKey,
  appointments,
  anchor,
  view,
}: {
  dayKey: string;
  appointments: CalendarAppointment[];
  anchor: Date;
  view: ViewMode;
}) {
  // For the week view, show the anchored day's stops (route is per-day).
  const stops = React.useMemo(
    () =>
      appointments
        .filter((a) => localDayKey(a.startMs) === dayKey && a.status !== 'cancelled')
        .sort((a, b) => a.startMs - b.startMs),
    [appointments, dayKey]
  );

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-box border border-base-content/10 bg-base-100 shadow-card"
    >
      <div className="flex items-center gap-2 border-b border-base-content/10 bg-base-200 px-4 py-3">
        <MapIcon className="h-5 w-5 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold text-base-content">
          Route map (Mapbox) — coming soon
        </span>
      </div>
      <div className="p-4">
        <p className="mb-3 text-sm text-base-content/70">
          Stops for {fmtDayLabel(anchor)}
          {view === 'week' ? ' (selected day)' : ''}, in order:
        </p>
        {stops.length === 0 ? (
          <p className="text-sm text-base-content/50">No stops on this day.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {stops.map((s, i) => (
              <li
                key={s.id}
                className="flex items-start gap-3 rounded-box border border-base-content/10 bg-base-200/50 px-3 py-2"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-content">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-base-content">
                    {fmtTime(s.startMs)} · {s.petName ?? 'Appointment'}
                    {s.clientName ? ` · ${s.clientName}` : ''}
                  </p>
                  <p className="truncate text-xs text-base-content/60">
                    {s.serviceAddress ?? 'No address on file'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </motion.div>
  );
}

// ===========================================================================
// Add booking modal
// ===========================================================================

function AddBookingModal({
  prefillStartMs,
  onClose,
  onCreated,
}: {
  prefillStartMs: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [clients, setClients] = React.useState<ManualBookingClient[]>([]);
  const [services, setServices] = React.useState<ManualBookingService[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [clientId, setClientId] = React.useState('');
  const [petId, setPetId] = React.useState('');
  const [serviceId, setServiceId] = React.useState('');
  const [startLocal, setStartLocal] = React.useState('');
  const [durationMin, setDurationMin] = React.useState(60);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getManualBookingOptions();
      if (cancelled) return;
      if (res.ok) {
        setClients(res.clients);
        setServices(res.services);
      } else {
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialise the datetime-local input from the prefill (local time).
  React.useEffect(() => {
    const d = new Date(prefillStartMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    setStartLocal(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}`
    );
  }, [prefillStartMs]);

  const selectedClient = clients.find((c) => c.id === clientId);
  const pets = selectedClient?.pets ?? [];

  // When a service is chosen, prefill duration from its default.
  React.useEffect(() => {
    const svc = services.find((s) => s.id === serviceId);
    if (svc) setDurationMin(svc.durationMinutes);
  }, [serviceId, services]);

  const canSubmit = clientId && petId && serviceId && startLocal && durationMin > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    const startMs = new Date(startLocal).getTime();
    const endMs = startMs + durationMin * MS_PER_MINUTE;
    const svcAddr = selectedClient?.serviceAddress;
    const res = await createManualAppointment({
      clientId,
      petId,
      serviceId,
      startMs,
      endMs,
      serviceAddress: svcAddr,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success('Booking added.');
      onCreated();
    } else if ('reason' in res && res.reason === 'conflict') {
      toast.error('That time overlaps another appointment. Pick another time.', {
        duration: Infinity,
      });
    } else {
      toast.error('error' in res ? res.error : "Couldn't add the booking.", {
        duration: Infinity,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add booking"
    >
      <div className="absolute inset-0 bg-neutral/40" onClick={onClose} aria-hidden="true" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.25 }}
        className="relative z-10 w-full max-w-md rounded-t-box border border-base-content/10 bg-base-100 p-5 shadow-card sm:rounded-box"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-base-content">Add booking</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost btn-circle min-h-[44px] min-w-[44px]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="loading loading-spinner loading-md" aria-hidden="true" />
          </div>
        ) : error ? (
          <p className="py-4 text-sm text-error">{error}</p>
        ) : clients.length === 0 || services.length === 0 ? (
          <div className="py-4 text-sm text-base-content/70">
            <p>
              You need at least one client (with a pet) and one active service
              before you can add a booking here.
            </p>
            <p className="mt-2">
              New-client creation from the calendar is coming soon — add clients
              on the{' '}
              <a href="/clients" className="link link-primary">
                Clients
              </a>{' '}
              page for now.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-base-content/70">Client</span>
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setPetId('');
                }}
                required
                className="select select-bordered min-h-[44px] border-base-content/10 bg-base-200"
              >
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-base-content/70">Pet</span>
              <select
                value={petId}
                onChange={(e) => setPetId(e.target.value)}
                required
                disabled={!selectedClient}
                className="select select-bordered min-h-[44px] border-base-content/10 bg-base-200"
              >
                <option value="">
                  {selectedClient ? 'Select a pet…' : 'Choose a client first'}
                </option>
                {pets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.breed ? ` · ${p.breed}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-base-content/70">Service</span>
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                required
                className="select select-bordered min-h-[44px] border-base-content/10 bg-base-200"
              >
                <option value="">Select a service…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationMinutes} min)
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-base-content/70">Start</span>
                <input
                  type="datetime-local"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                  required
                  className="input input-bordered min-h-[44px] border-base-content/10 bg-base-200"
                />
              </label>
              <label className="flex w-28 flex-col gap-1 text-sm">
                <span className="text-base-content/70">Minutes</span>
                <input
                  type="number"
                  min={SLOT_STEP_MIN}
                  step={SLOT_STEP_MIN}
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  required
                  className="input input-bordered min-h-[44px] border-base-content/10 bg-base-200"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="btn btn-primary mt-2 min-h-[44px]"
            >
              {submitting ? (
                <span className="loading loading-spinner loading-sm" aria-hidden="true" />
              ) : (
                'Add booking'
              )}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}

export default CalendarView;
