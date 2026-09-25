'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  MapPin,
  MapPinOff,
  Route,
  Truck,
  Radar,
  TrendingUp,
  TrendingDown,
  Minus,
  MessageSquare,
  RefreshCw,
  Lock,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Reveal, NumberTicker } from '@/components/motion';
import { updateAppointmentStatus } from '@/actions/appointments';
import type { AppointmentStatus } from '@/types';

/**
 * DashboardView — the portal's bento dashboard (Master Spec §8).
 *
 * A calm, responsive bento grid (1 column on mobile, 2–3 columns md+) built
 * from serializable data projected by the server page. Cards:
 *  - Today's Route: vertical timeline of today's stops with travel chips
 *    between them, per-stop maps deep link, status badge, and one-tap status
 *    actions (Start / Complete) backed by `updateAppointmentStatus`.
 *  - Order Radar: latest upcoming request(s) with distance / extra drive /
 *    best-fit label; Accept/Decline in `request` booking mode.
 *  - This month: bookings, revenue, no-show rate with month-over-month diff.
 *  - Rebooking due (placeholder — Phase 7) and SMS credits (placeholder — Phase 4/5).
 *
 * Motion is subtle (Reveal entrance). Tapping a stop navigates to its detail.
 *
 * _Master Spec: §8, §10.5. Requirements: 9.2, 9.3, 9.4, 9.5, 16.1_
 */

/* ----------------------------- Serializable props ----------------------------- */

export interface TravelChip {
  minutes: number;
  km: number;
}

export interface DashboardStop {
  id: string;
  petName: string | null;
  clientName: string | null;
  serviceName: string | null;
  serviceAddress: string | null;
  /** ISO-8601 scheduled start. */
  scheduledDate: string;
  /** Pre-formatted local time label (e.g. "9:30 AM"). */
  timeLabel: string;
  status: AppointmentStatus;
  /** Travel from this stop to the next; null when it cannot be computed. */
  travelToNext: TravelChip | null;
}

export interface RadarItem {
  id: string;
  petName: string | null;
  clientName: string | null;
  scheduledDate: string;
  timeLabel: string;
  fromPrevKm: number | null;
  extraDriveMin: number | null;
  label: string | null;
}

export interface MonthSummary {
  bookings: number;
  revenue: number;
  noShowRate: number;
  bookingsDiffPct: number | null;
  revenueDiffPct: number | null;
  noShowRateDiff: number;
}

export interface DashboardData {
  stops: DashboardStop[];
  radar: RadarItem[];
  bookingMode: 'instant' | 'request';
  monthSummary: MonthSummary;
  /** Real SMS allowance from entitlements (§13.4). */
  smsIncluded: number;
  /** SMS used this cycle (0 when Redis is unconfigured). */
  smsUsed: number;
  /** UI hint: the plan lacks Order Radar (server gate is authoritative, §13.1). */
  radarLocked: boolean;
  /** The first fillable gap today, or null when there is none (§11.1). */
  fillGap: { startMs: number; endMs: number; label: string } | null;
  /** Fill My Day recovered revenue this month (selling metric, §11.1). */
  fillRecoveredThisMonth: number;
  /** UI hint: the plan lacks Fill My Day (server gate is authoritative, §13.1). */
  fillLocked: boolean;
}

interface DashboardViewProps {
  data: DashboardData;
}

/* --------------------------------- helpers --------------------------------- */

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

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

function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={cx('badge badge-sm', STATUS_BADGE[status] ?? 'badge-ghost')}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function mapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    address
  )}`;
}

/* ------------------------------- Today's Route ------------------------------- */

/** A travel chip rendered between two consecutive stops. */
function TravelChipRow({ chip }: { chip: TravelChip }) {
  return (
    <div
      className="flex items-center gap-2 py-1 pl-[7px] text-xs text-base-content/60"
      aria-label={`Drive ${chip.minutes} minutes, ${chip.km} kilometres to next stop`}
    >
      <span
        className="ml-[-1px] h-6 w-0.5 rounded-full bg-base-content/10"
        aria-hidden="true"
      />
      <span className="inline-flex items-center gap-1 rounded-badge bg-base-200 px-2 py-0.5">
        <Truck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        {chip.minutes} min · {chip.km} km
      </span>
    </div>
  );
}

/** One-tap status action buttons for a stop (Start / Complete). */
function StopActions({
  stop,
  onChanged,
}: {
  stop: DashboardStop;
  onChanged: () => void;
}) {
  const [pending, setPending] = React.useState<null | AppointmentStatus | 'omw'>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (next: AppointmentStatus) => {
      setError(null);
      setPending(next);
      const res = await updateAppointmentStatus({
        appointmentId: stop.id,
        newStatus: next,
      });
      setPending(null);
      if (res.ok) {
        onChanged();
      } else {
        setError(res.error);
      }
    },
    [stop.id, onChanged]
  );

  // "On my way" is a tracking action (Phase 11), not a status change — it stays
  // a non-mutating stub for now so the affordance is present.
  const [omwArmed, setOmwArmed] = React.useState(false);

  if (stop.status === 'completed' || stop.status === 'cancelled') {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {stop.status === 'upcoming' && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOmwArmed(true);
              // TODO(phase-11): open live "van is on the way" tracking link.
            }}
            className="btn btn-outline btn-sm min-h-[40px]"
          >
            {omwArmed ? 'On my way ✓' : 'On my way'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void run('in-progress');
            }}
            disabled={pending !== null}
            className="btn btn-primary btn-sm min-h-[40px]"
          >
            {pending === 'in-progress' ? 'Starting…' : 'Start'}
          </button>
        </>
      )}
      {stop.status === 'in-progress' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void run('completed');
          }}
          disabled={pending !== null}
          className="btn btn-success btn-sm min-h-[40px]"
        >
          {pending === 'completed' ? 'Completing…' : 'Complete'}
        </button>
      )}
      {error && (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      )}
    </div>
  );
}

function RouteStop({
  stop,
  onOpen,
  onChanged,
}: {
  stop: DashboardStop;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  return (
    <li className="relative">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open appointment for ${stop.petName ?? 'pet'} at ${stop.timeLabel}`}
        onClick={() => onOpen(stop.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(stop.id);
          }
        }}
        className="cursor-pointer rounded-box border border-base-content/10 bg-base-100 p-3 transition-colors hover:bg-base-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-base-content">
              {stop.timeLabel}
            </p>
            <p className="truncate text-base font-medium text-base-content">
              {stop.petName ?? 'Unnamed pet'}
            </p>
            {stop.serviceName && (
              <p className="truncate text-sm text-base-content/60">
                {stop.serviceName}
                {stop.clientName ? ` · ${stop.clientName}` : ''}
              </p>
            )}
          </div>
          <StatusBadge status={stop.status} />
        </div>

        {stop.serviceAddress ? (
          <a
            href={mapsDirectionsUrl(stop.serviceAddress)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-2"
          >
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Directions</span>
          </a>
        ) : (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm italic text-base-content/50">
            <MapPinOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            Address unavailable
          </p>
        )}

        <StopActions stop={stop} onChanged={onChanged} />
      </div>

      {stop.travelToNext && <TravelChipRow chip={stop.travelToNext} />}
    </li>
  );
}

function TodaysRouteCard({
  stops,
  onOpen,
  onChanged,
}: {
  stops: DashboardStop[];
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <div className="mb-4 flex items-center gap-2">
        <Route className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-base-content">
          Today&apos;s Route
        </h2>
      </div>

      {stops.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-box bg-base-200 px-4 py-10 text-center">
          <CalendarClock
            className="mb-3 h-8 w-8 text-base-content/40"
            aria-hidden="true"
          />
          <p className="font-medium text-base-content">No stops today</p>
          <p className="mt-1 text-sm text-base-content/60">
            Enjoy the breather — new bookings will show up here.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {stops.map((stop) => (
            <RouteStop
              key={stop.id}
              stop={stop}
              onOpen={onOpen}
              onChanged={onChanged}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}

/* -------------------------------- Order Radar -------------------------------- */

function RadarRow({
  item,
  bookingMode,
  onOpen,
}: {
  item: RadarItem;
  bookingMode: 'instant' | 'request';
  onOpen: (id: string) => void;
}) {
  // Text pattern (§10.5): "New booking · {km} km from your {time} stop ·
  // +{min} min driving · {label}". Each fragment is omitted gracefully.
  const parts: string[] = ['New booking'];
  if (item.fromPrevKm != null) parts.push(`${item.fromPrevKm} km away`);
  if (item.extraDriveMin != null) parts.push(`+${item.extraDriveMin} min driving`);
  if (item.label) parts.push(item.label);

  return (
    <div className="rounded-box border border-base-content/10 bg-base-100 p-3">
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="block w-full text-left"
      >
        <p className="text-sm font-medium text-base-content">
          {item.petName ?? 'New pet'}
          <span className="text-base-content/60">
            {' '}
            · {item.timeLabel}
          </span>
        </p>
        <p className="mt-1 text-sm text-base-content/70">{parts.join(' · ')}</p>
      </button>

      {bookingMode === 'request' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* TODO(phase-3/6): wire Accept/Decline to the request-mode handler. */}
          <button type="button" className="btn btn-primary btn-sm min-h-[40px]">
            Accept
          </button>
          <button type="button" className="btn btn-ghost btn-sm min-h-[40px]">
            Decline
          </button>
        </div>
      ) : (
        <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-success">
          Auto-confirmed
        </p>
      )}
    </div>
  );
}

/**
 * Locked Order Radar cell shown when the plan lacks `orderRadar` (§13.1). This
 * is a UI hint only — the server gate on /api/portal/radar is authoritative.
 */
function OrderRadarLocked() {
  return (
    <Card className="flex flex-col">
      <div className="mb-4 flex items-center gap-2">
        <Radar className="h-5 w-5 text-base-content/40" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-base-content">
          Order Radar
        </h2>
        <Lock className="ml-auto h-4 w-4 text-base-content/40" aria-hidden="true" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center rounded-box bg-base-200 px-4 py-8 text-center">
        <p className="font-medium text-base-content">A Pro feature</p>
        <p className="mt-1 text-sm text-base-content/60">
          See how far each new booking is from your route and how much driving it
          adds.
        </p>
        <Link href="/billing" className="btn btn-primary btn-sm mt-4 min-h-[44px]">
          Upgrade to Pro
        </Link>
      </div>
    </Card>
  );
}

function OrderRadarCard({
  radar,
  bookingMode,
  onOpen,
}: {
  radar: RadarItem[];
  bookingMode: 'instant' | 'request';
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="flex flex-col">
      <div className="mb-4 flex items-center gap-2">
        <Radar className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-base-content">
          Order Radar
        </h2>
      </div>
      {radar.length === 0 ? (
        <p className="rounded-box bg-base-200 px-4 py-6 text-center text-sm text-base-content/60">
          No new bookings right now.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {radar.map((item) => (
            <RadarRow
              key={item.id}
              item={item}
              bookingMode={bookingMode}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------ This month card ------------------------------ */

function DiffPill({
  value,
  suffix = '%',
  invert = false,
}: {
  value: number | null;
  suffix?: string;
  /** When true, a negative change is "good" (e.g. no-show rate). */
  invert?: boolean;
}) {
  if (value == null) {
    return <span className="text-xs text-base-content/40">—</span>;
  }
  const positive = value > 0;
  const neutral = value === 0;
  const good = invert ? value < 0 : value > 0;

  const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        neutral ? 'text-base-content/50' : good ? 'text-success' : 'text-error'
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {value > 0 ? '+' : ''}
      {value}
      {suffix}
    </span>
  );
}

function Metric({
  label,
  children,
  diff,
}: {
  label: string;
  children: React.ReactNode;
  diff: React.ReactNode;
}) {
  return (
    <div className="rounded-box bg-base-200 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-base-content/50">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-base-content">{children}</p>
      <div className="mt-1">{diff}</div>
    </div>
  );
}

function ThisMonthCard({ summary }: { summary: MonthSummary }) {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-base-content">
          This month
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Metric
          label="Bookings"
          diff={<DiffPill value={summary.bookingsDiffPct} />}
        >
          <NumberTicker value={summary.bookings} />
        </Metric>
        <Metric
          label="Revenue"
          diff={<DiffPill value={summary.revenueDiffPct} />}
        >
          <NumberTicker value={summary.revenue} prefix="$" decimals={0} />
        </Metric>
        <Metric
          label="No-show rate"
          diff={<DiffPill value={summary.noShowRateDiff} suffix="pt" invert />}
        >
          <NumberTicker value={summary.noShowRate} suffix="%" decimals={1} />
        </Metric>
      </div>
      <p className="mt-3 text-xs text-base-content/50">
        Compared with the previous month.
      </p>
    </Card>
  );
}

/* ------------------------------- Placeholders ------------------------------- */

/**
 * Fill My Day card (§11.1). Shows the month's recovered revenue and, when a
 * gap exists today, a "Fill this gap" button that triggers /api/portal/fill.
 * The button is a UI affordance; the server route re-checks the Pro gate.
 */
function FillMyDayCard({
  gap,
  recovered,
  locked,
  onFilled,
}: {
  gap: DashboardData['fillGap'];
  recovered: number;
  locked: boolean;
  onFilled: () => void;
}) {
  const [pending, setPending] = React.useState(false);

  const fill = React.useCallback(async () => {
    if (!gap) return;
    setPending(true);
    try {
      const res = await fetch('/api/portal/fill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gapStartMs: gap.startMs, gapEndMs: gap.endMs }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        offered?: number;
        reason?: string;
      };
      if (res.status === 403) {
        toast.error('Fill My Day is a Pro feature. Upgrade to unlock it.');
      } else if (res.ok) {
        if (data.offered && data.offered > 0) {
          toast.success(`Offered this gap to ${data.offered} nearby client${data.offered === 1 ? '' : 's'}.`);
        } else {
          toast.info('No matching clients to offer this gap right now.');
        }
        onFilled();
      } else {
        toast.error('Could not start Fill My Day. Please try again.');
      }
    } catch {
      toast.error('Could not start Fill My Day. Please try again.');
    } finally {
      setPending(false);
    }
  }, [gap, onFilled]);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-base-content">
          Fill My Day
        </h2>
        {locked && <Lock className="ml-auto h-4 w-4 text-base-content/40" aria-hidden="true" />}
      </div>

      {recovered > 0 && (
        <p className="mb-3 text-sm text-base-content/70">
          Recovered{' '}
          <span className="font-semibold text-success">${recovered}</span> this month.
        </p>
      )}

      {locked ? (
        <>
          <p className="text-sm text-base-content/60">
            Auto-offer a cancelled slot to nearby waitlisted and overdue clients.
          </p>
          <Link href="/billing" className="btn btn-primary btn-sm mt-3 min-h-[44px]">
            Upgrade to Pro
          </Link>
        </>
      ) : gap ? (
        <>
          <p className="text-sm text-base-content/60">
            You have an open gap today ({gap.label}). Offer it to nearby clients.
          </p>
          <button
            type="button"
            onClick={() => void fill()}
            disabled={pending}
            className="btn btn-primary btn-sm mt-3 min-h-[44px]"
          >
            {pending ? 'Sending offers…' : 'Fill this gap'}
          </button>
        </>
      ) : (
        <p className="text-sm text-base-content/60">
          No open gaps today. When a slot opens up, offer it here to nearby
          clients in a tap.
        </p>
      )}
    </Card>
  );
}

function RebookingCard() {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <RefreshCw className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-base-content">
          Rebooking due
        </h2>
      </div>
      <p className="text-sm text-base-content/60">
        Rebooking autopilot texts clients a prefilled booking link when their
        pet is due for another groom — on a daily schedule, hands-free.
      </p>
      <span className="mt-3 inline-flex items-center rounded-badge bg-success/10 px-3 py-1 text-xs font-medium text-success">
        Running daily
      </span>
    </Card>
  );
}

function SmsCreditsCard({ used, included }: { used: number; included: number }) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-base-content">
          SMS credits
        </h2>
      </div>
      {/* Live allowance/usage from entitlements + the SMS quota counter (§13.4). */}
      <p className="text-2xl font-bold text-base-content">
        {used}
        <span className="text-base font-medium text-base-content/50">
          /{included} used
        </span>
      </p>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-base-200"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="SMS usage this cycle"
      >
        <div
          className={cx('h-full rounded-full', pct >= 100 ? 'bg-error' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <Link href="/billing" className="btn btn-outline btn-sm mt-3 min-h-[40px]">
        Top up
      </Link>
    </Card>
  );
}

/* --------------------------------- View --------------------------------- */

export function DashboardView({ data }: DashboardViewProps) {
  const router = useRouter();
  const {
    stops,
    radar,
    bookingMode,
    monthSummary,
    smsIncluded,
    smsUsed,
    radarLocked,
    fillGap,
    fillRecoveredThisMonth,
    fillLocked,
  } = data;

  const handleOpen = React.useCallback(
    (id: string) => {
      router.push(`/appointments/${id}`);
    },
    [router]
  );

  // Refresh server data after a status change so the timeline reflects it.
  const handleChanged = React.useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-base-content sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-1 text-base-content/60">
          Your day at a glance.
        </p>
      </header>

      {/* Bento: 1 col mobile → 2–3 cols md+. Today's Route spans two rows on
          desktop so the timeline has room. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Reveal className="md:row-span-2" y={12} duration={0.28}>
          <TodaysRouteCard
            stops={stops}
            onOpen={handleOpen}
            onChanged={handleChanged}
          />
        </Reveal>

        <Reveal y={12} duration={0.28} delay={0.04}>
          {radarLocked ? (
            <OrderRadarLocked />
          ) : (
            <OrderRadarCard
              radar={radar}
              bookingMode={bookingMode}
              onOpen={handleOpen}
            />
          )}
        </Reveal>

        <Reveal y={12} duration={0.28} delay={0.08}>
          <ThisMonthCard summary={monthSummary} />
        </Reveal>

        <Reveal y={12} duration={0.28} delay={0.12}>
          <FillMyDayCard
            gap={fillGap}
            recovered={fillRecoveredThisMonth}
            locked={fillLocked}
            onFilled={handleChanged}
          />
        </Reveal>

        <Reveal y={12} duration={0.28} delay={0.16}>
          <RebookingCard />
        </Reveal>

        <Reveal y={12} duration={0.28} delay={0.2}>
          <SmsCreditsCard used={smsUsed} included={smsIncluded} />
        </Reveal>
      </div>
    </div>
  );
}

export default DashboardView;
