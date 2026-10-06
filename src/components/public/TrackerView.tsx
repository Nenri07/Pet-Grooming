'use client';

/**
 * TrackerView — public "van is on the way" tracker (Master Spec §11.2).
 *
 * Branded header (groomer logo/name), an ETA read-out, a real interactive map
 * showing the live groomer van moving toward the client's destination pin, the
 * pet name, and Call / Text groomer buttons. Polls `/api/track/{token}` every
 * 10s to refresh the ETA + position; stops polling once the trip ends.
 *
 * The map is Mapbox GL JS ({@link TrackerMapbox}) when a public browser token
 * (`NEXT_PUBLIC_MAPBOX_TOKEN`) is configured, else it falls back to Leaflet +
 * free OpenStreetMap tiles ({@link TrackerMap}, no API key). Either variant is
 * loaded via `next/dynamic` with `ssr: false` so their `window` access never
 * runs on the server.
 *
 * Theme tokens only; 44px+ targets.
 *
 * _Master Spec: §11.2_
 */
import * as React from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Navigation, Phone, MessageSquare, PawPrint } from 'lucide-react';
import { safeHttpsImageSrc } from '@/lib/images';

/**
 * Shared loading fallback — mirrors the map's height so nothing jumps while
 * the client-only map chunk hydrates.
 */
const MapSkeleton = () => (
  <div
    className="h-72 w-full animate-pulse rounded-box border border-base-content/10 bg-base-200 sm:h-80"
    aria-hidden="true"
  />
);

/**
 * Client-only maps — both Mapbox GL and Leaflet touch `window`, so neither may
 * render on the server. We dynamically import both and pick one at render time
 * based on whether a public Mapbox token is configured.
 */
const TrackerMapbox = dynamic(() => import('./TrackerMapbox'), {
  ssr: false,
  loading: MapSkeleton,
});
const TrackerMap = dynamic(() => import('./TrackerMap'), {
  ssr: false,
  loading: MapSkeleton,
});

/**
 * Is a non-empty, non-placeholder Mapbox token configured? Mirrors the shared
 * `isSet` convention used across config (empty / `…replace_me` / `your-…` ⇒
 * "not configured"); kept inline so this client component never imports
 * server-only config.
 */
function isMapboxToken(value: string | undefined): value is string {
  if (!value) return false;
  const t = value.trim();
  if (t.length === 0) return false;
  if (t.includes('replace_me') || t.startsWith('your-')) return false;
  return true;
}

interface TrackerPayload {
  business: string;
  logoUrl: string | null;
  petName: string | null;
  groomerPhone: string | null;
  van: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  etaMinutes: number | null;
  ended: boolean;
  /** True when the server can't store/read live positions (Redis off). */
  liveUnavailable?: boolean;
}

interface TrackerViewProps {
  token: string;
  initial: TrackerPayload;
}

/** Poll interval for the tracker (§11.2: every 10s). */
const POLL_MS = 10_000;

export function TrackerView({ token, initial }: TrackerViewProps) {
  const [data, setData] = React.useState<TrackerPayload>(initial);

  React.useEffect(() => {
    if (data.ended) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/track/${token}`, { cache: 'no-store' });
        if (!res.ok) return;
        const next = (await res.json()) as TrackerPayload;
        if (!cancelled) setData(next);
      } catch {
        // Ignore transient poll errors; the next tick retries.
      }
    };

    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, data.ended]);

  const etaLabel =
    data.etaMinutes == null
      ? null
      : data.etaMinutes <= 1
        ? 'Arriving now'
        : `${data.etaMinutes} min away`;

  // `NEXT_PUBLIC_*` is inlined at build time, so this read is a static string
  // in the client bundle. Prefer Mapbox GL when a public token is set, else
  // degrade to the Leaflet + OpenStreetMap map.
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const useMapbox = React.useMemo(() => isMapboxToken(mapboxToken), [mapboxToken]);

  return (
    <div className="overflow-hidden rounded-box border border-base-content/10 bg-base-100 shadow-card">
      {/* Branded header */}
      <div className="bg-hero px-6 py-7 text-center">
        {safeHttpsImageSrc(data.logoUrl) ? (
          <Image
            src={safeHttpsImageSrc(data.logoUrl) as string}
            alt={data.business}
            width={56}
            height={56}
            className="mx-auto h-14 w-14 rounded-full object-cover ring-2 ring-base-100"
          />
        ) : (
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-base-100/80 text-primary ring-2 ring-base-100">
            <PawPrint className="h-7 w-7" aria-hidden="true" />
          </div>
        )}
        <p className="mt-3 font-display text-lg font-semibold text-base-content">
          {data.business}
        </p>
      </div>

      <div className="px-6 py-6">
        {data.ended ? (
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-base-content">Arrived</h1>
            <p className="mt-2 text-base-content/70">
              Your groomer has arrived{data.petName ? ` for ${data.petName}` : ''}. 🐾
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-center font-display text-2xl font-bold text-base-content">
              On the way{data.petName ? ` to ${data.petName}` : ''}
            </h1>

            {/* ETA read-out */}
            <div className="mt-5 flex items-center justify-center gap-2 text-primary">
              <Navigation className="h-6 w-6" aria-hidden="true" />
              <span className="text-3xl font-bold tabular-nums">
                {etaLabel ?? 'Locating…'}
              </span>
            </div>

            {/* Live interactive map — Mapbox GL when a public token is set,
                else Leaflet + OpenStreetMap (no API key). */}
            <div className="mt-5">
              {data.van ? (
                useMapbox ? (
                  <TrackerMapbox
                    van={data.van}
                    destination={data.destination}
                    etaLabel={etaLabel}
                    business={data.business}
                    token={mapboxToken as string}
                  />
                ) : (
                  <TrackerMap
                    van={data.van}
                    destination={data.destination}
                    etaLabel={etaLabel}
                    business={data.business}
                  />
                )
              ) : (
                <div className="flex h-72 w-full flex-col items-center justify-center rounded-box border border-base-content/10 bg-base-200 p-5 text-center sm:h-80">
                  {data.liveUnavailable ? (
                    <p className="text-sm text-base-content/70">
                      Live location isn&apos;t available for this trip. Your groomer
                      is on the way — hang tight, or call/text them below.
                    </p>
                  ) : (
                    <>
                      <span className="h-3 w-3 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                      <p className="mt-3 text-sm italic text-base-content/60">
                        Waiting for the van to start sharing…
                      </p>
                    </>
                  )}
                </div>
              )}
              {!data.liveUnavailable && (
                <p className="mt-2 text-center text-xs text-base-content/50">
                  Location updates automatically every few seconds.
                </p>
              )}
            </div>
          </>
        )}

        {/* Call / Text groomer */}
        {data.groomerPhone && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <a
              href={`tel:${data.groomerPhone}`}
              className="btn btn-outline min-h-[48px]"
            >
              <Phone className="h-5 w-5" aria-hidden="true" />
              Call
            </a>
            <a
              href={`sms:${data.groomerPhone}`}
              className="btn btn-outline min-h-[48px]"
            >
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
              Text
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default TrackerView;
