'use client';
import * as React from 'react';
import type { Demo } from '@/content/demos';
// Import from the specific routing submodules (NOT the `@/lib/routing` barrel):
// the barrel re-exports the geocode provider, which pulls in `node:crypto` and
// cannot be bundled into this client component. geo/insertion/scoring are pure.
import {
  HaversineTravelProvider,
  DEFAULT_TRAVEL_CFG,
  haversineKm,
  type LatLng,
} from '@/lib/routing/geo';
import {
  evaluateInsertion,
  type Stop,
  type Cand,
  type InsertionResult,
} from '@/lib/routing/insertion';
import { scoreInsertion, labelForScore } from '@/lib/routing/scoring';

/** Local mirrors of the §10 defaults (kept off the barrel to stay client-safe). */
const ROUTING = { bufferMin: 10, clusterKm: 8 } as const;

/**
 * DemoRadar — interactive Order Radar preview for a prospect demo (Master Spec
 * §17). Everything here is FAKE sample data scattered around the prospect's
 * city centroid; nothing is persisted and no address is real.
 *
 * It reuses the real routing math (`@/lib/routing`: haversine travel model +
 * `evaluateInsertion` + `scoreInsertion`) so the "+X min driving / Y km" figures
 * are computed the exact same way the live product computes them — just against
 * three fabricated local stops. The visual language mirrors OrderRadarShowcase
 * (percentage-positioned SVG map, primary/accent tokens) but this variant is
 * INTERACTIVE: the prospect taps a candidate booking and watches the detour
 * recompute.
 *
 * SSR/JS-off: the map and the first candidate's summary render statically from
 * a precomputed value, so there is no blank state without JS.
 */

/** Fake day, in local wall-clock hours, used only to build plausible stop times. */
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 17;

/** A fabricated candidate booking the prospect can preview. */
interface DemoCandidate {
  id: string;
  /** Label shown on the pill, e.g. "Thu 2:30". */
  label: string;
  /** Offset in km east/north of the city centre (keeps stops "local"). */
  offsetKm: { east: number; north: number };
  /** Start hour (local) for the candidate slot. */
  startHour: number;
  /** Duration in minutes. */
  durationMin: number;
}

/** Three fixed existing stops (as km offsets from the city centre). */
const FAKE_STOPS: { east: number; north: number; startHour: number; durationMin: number }[] = [
  { east: -3.2, north: 2.1, startHour: 9.5, durationMin: 60 },
  { east: 1.8, north: 3.6, startHour: 11, durationMin: 75 },
  { east: 4.1, north: -1.4, startHour: 13.25, durationMin: 60 },
];

/** Candidate bookings the prospect can tap to preview. */
const CANDIDATES: DemoCandidate[] = [
  { id: 'a', label: 'Thu 2:30', offsetKm: { east: 3.0, north: -2.2 }, startHour: 14.5, durationMin: 60 },
  { id: 'b', label: 'Thu 4:00', offsetKm: { east: 9.5, north: 6.0 }, startHour: 16, durationMin: 60 },
  { id: 'c', label: 'Thu 10:30', offsetKm: { east: -2.6, north: 2.8 }, startHour: 10.5, durationMin: 45 },
];

/** Kilometres → degrees, so we can scatter stops around a real city centroid. */
function offsetToLatLng(center: LatLng, eastKm: number, northKm: number): LatLng {
  const latPerKm = 1 / 110.574;
  const lngPerKm = 1 / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return { lat: center.lat + northKm * latPerKm, lng: center.lng + eastKm * lngPerKm };
}

/** Build an epoch-ms timestamp for a given wall-clock hour on a fixed demo day. */
function hourToMs(hour: number): number {
  // Fixed reference day (arbitrary, stable) so the math is deterministic.
  const base = Date.UTC(2025, 0, 2, 0, 0, 0); // a Thursday
  return base + hour * 3_600_000;
}

/** Project a lat/lng to a 0..100 percentage position within the map panel. */
function toPercent(center: LatLng, p: LatLng): { x: number; y: number } {
  // ~12km half-window around the centre maps to the panel edges.
  const spanKm = 12;
  const dxKm = haversineKm(center, { lat: center.lat, lng: p.lng }) * (p.lng >= center.lng ? 1 : -1);
  const dyKm = haversineKm(center, { lat: p.lat, lng: center.lng }) * (p.lat >= center.lat ? 1 : -1);
  return {
    x: Math.max(6, Math.min(94, 50 + (dxKm / spanKm) * 44)),
    y: Math.max(8, Math.min(92, 50 - (dyKm / spanKm) * 44)),
  };
}

interface Computed {
  result: InsertionResult | null;
  score: number;
  label: string | null;
}

export function DemoRadar({ demo }: { demo: Demo }) {
  // Memoised so it's a stable dependency for the compute effect below.
  const center = React.useMemo<LatLng>(
    () => ({ lat: demo.lat, lng: demo.lng }),
    [demo.lat, demo.lng]
  );

  // Build the fixed stops once per demo.
  const { stops, base, dayWindow, stopPercents } = React.useMemo(() => {
    const base = offsetToLatLng(center, 0, 0); // day starts/ends at city centre
    const stops: Stop[] = FAKE_STOPS.map((s, i) => ({
      id: `stop-${i}`,
      loc: offsetToLatLng(center, s.east, s.north),
      startMs: hourToMs(s.startHour),
      endMs: hourToMs(s.startHour + s.durationMin / 60),
    }));
    const dayWindow = { startMs: hourToMs(DAY_START_HOUR), endMs: hourToMs(DAY_END_HOUR) };
    const stopPercents = stops.map((s) => ({
      ...toPercent(center, s.loc),
      time: new Date(s.startMs).toISOString().slice(11, 16),
    }));
    return { stops, base, dayWindow, stopPercents };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.slug, demo.lat, demo.lng]);

  const [selectedId, setSelectedId] = React.useState<string>(CANDIDATES[0].id);
  const [computed, setComputed] = React.useState<Record<string, Computed>>({});

  const tp = React.useMemo(() => new HaversineTravelProvider(DEFAULT_TRAVEL_CFG), []);

  // Compute routing metrics for every candidate (async provider) once mounted.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, Computed> = {};
      const clusterDay =
        stops.filter((s, i) =>
          stops.some((o, j) => j !== i && haversineKm(s.loc, o.loc) <= ROUTING.clusterKm)
        ).length >= 2;

      for (const cand of CANDIDATES) {
        const loc = offsetToLatLng(center, cand.offsetKm.east, cand.offsetKm.north);
        const c: Cand = {
          loc,
          startMs: hourToMs(cand.startHour),
          endMs: hourToMs(cand.startHour + cand.durationMin / 60),
        };
        const result = await evaluateInsertion(
          stops,
          base,
          c,
          { bufferMin: ROUTING.bufferMin },
          tp,
          dayWindow
        );
        const score = result ? scoreInsertion(result, { clusterDay }) : 0;
        const label = result ? labelForScore(score, result.extraDriveMin) : null;
        next[cand.id] = { result, score, label };
      }
      if (!cancelled) setComputed(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [stops, base, dayWindow, tp, center]);

  const selected = CANDIDATES.find((c) => c.id === selectedId) ?? CANDIDATES[0];
  const selectedComputed = computed[selectedId];
  const candPercent = toPercent(
    center,
    offsetToLatLng(center, selected.offsetKm.east, selected.offsetKm.north)
  );

  // Find the "from" stop time to phrase the radar line like the live product.
  const prevStop =
    selectedComputed?.result?.prevId != null
      ? stopPercents[stops.findIndex((s) => s.id === selectedComputed.result?.prevId)]
      : null;

  return (
    <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
      {/* ---- Candidate picker + summary ---- */}
      <div className="order-2 lg:order-1">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-accent">
          Order Radar preview
        </p>
        <h3 className="font-display text-2xl font-bold text-base-content">
          Tap a booking to see the detour
        </h3>
        <p className="mt-3 text-base-content/70">
          Sample bookings around {demo.city}. PawPort ranks each one by how well
          it fits your route — the exact same math your live booking page uses.
        </p>

        <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Sample bookings">
          {CANDIDATES.map((cand) => {
            const isActive = cand.id === selectedId;
            const label = computed[cand.id]?.label;
            return (
              <button
                key={cand.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setSelectedId(cand.id)}
                className={[
                  'btn btn-sm min-h-[44px] rounded-btn',
                  isActive ? 'btn-primary' : 'btn-outline border-base-content/20 text-base-content',
                ].join(' ')}
              >
                {cand.label}
                {label && (
                  <span
                    className={[
                      'ml-2 rounded-badge px-2 py-0.5 text-[0.65rem] font-semibold',
                      isActive ? 'bg-primary-content/20' : 'bg-accent/15 text-accent',
                    ].join(' ')}
                  >
                    {label}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Summary card */}
        <div className="mt-6 rounded-box border border-base-content/10 bg-base-100 p-5 shadow-card">
          {selectedComputed?.result ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                New booking · {selected.label}
              </p>
              <p className="mt-2 text-lg leading-snug text-base-content">
                {selectedComputed.result.fromPrevKm} km from your{' '}
                {prevStop ? prevStop.time : 'first'} stop ·{' '}
                <span className="font-semibold">
                  +{selectedComputed.result.extraDriveMin} min driving
                </span>
              </p>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-sm text-base-content/70">Route fit</span>
                <div className="h-2 flex-1 overflow-hidden rounded-badge bg-base-300">
                  <div
                    className="h-full rounded-badge bg-primary transition-all duration-500"
                    style={{ width: `${selectedComputed.score}%` }}
                  />
                </div>
                <span className="text-sm font-semibold tabular-nums text-base-content">
                  {selectedComputed.score}
                </span>
              </div>
              <div className="mt-4 flex gap-2">
                <span className="btn btn-primary btn-sm min-h-[44px]">Accept</span>
                <span className="btn btn-ghost btn-sm min-h-[44px] text-base-content/70">
                  Decline
                </span>
              </div>
            </>
          ) : (
            <p className="text-base-content/70">
              This booking falls outside a workable gap in the day — PawPort would
              flag it or suggest a better time.
            </p>
          )}
        </div>
      </div>

      {/* ---- Map panel (mirrors OrderRadarShowcase visual language) ---- */}
      <div className="order-1 lg:order-2">
        <div className="relative mx-auto aspect-[4/3] w-full max-w-xl rounded-box border border-base-content/10 bg-base-100 shadow-card">
          <div
            aria-hidden
            className="absolute inset-0 rounded-box bg-primary/5"
            style={{
              backgroundImage:
                'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
              backgroundSize: '2.5rem 2.5rem',
              color: 'oklch(var(--bc) / 0.06)',
            }}
          />

          <svg
            aria-hidden
            viewBox="0 0 100 75"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            <polyline
              points={stopPercents.map((s) => `${s.x},${s.y * 0.75}`).join(' ')}
              fill="none"
              stroke="oklch(var(--p) / 0.5)"
              strokeWidth="0.6"
              strokeDasharray="1.4 1.2"
            />
            <line
              x1={stopPercents[stopPercents.length - 1].x}
              y1={stopPercents[stopPercents.length - 1].y * 0.75}
              x2={candPercent.x}
              y2={candPercent.y * 0.75}
              stroke="oklch(var(--a) / 0.7)"
              strokeWidth="0.6"
              strokeDasharray="1.2 1"
            />
          </svg>

          {/* Existing stops */}
          {stopPercents.map((s, i) => (
            <div
              key={`stop-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-content shadow-glow">
                <span className="h-2 w-2 rounded-full bg-primary-content" />
              </span>
              <span className="mt-1 block text-center text-[0.65rem] font-semibold tabular-nums text-base-content/70">
                {s.time}
              </span>
            </div>
          ))}

          {/* Selected candidate pin */}
          <div
            className="absolute -translate-x-1/2 transition-all duration-500"
            style={{ left: `${candPercent.x}%`, top: `${candPercent.y}%` }}
          >
            <span className="relative flex h-6 w-6 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/50" />
              <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-content shadow-glow">
                <span className="h-2 w-2 rounded-full bg-accent-content" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DemoRadar;
