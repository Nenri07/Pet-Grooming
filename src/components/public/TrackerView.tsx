'use client';

/**
 * TrackerView — public "van is on the way" tracker (Master Spec §11.2).
 *
 * Branded header (groomer logo/name), an ETA read-out, a MAP PLACEHOLDER panel
 * (no Mapbox dependency — shows the van coordinates + ETA in a styled card),
 * the pet name, and Call / Text groomer buttons. Polls `/api/track/{token}`
 * every 10s to refresh the ETA + position; stops polling once the trip ends.
 *
 * MAP SEAM (§11.2): the coordinate/ETA panel stands in for a Mapbox map. When a
 * Mapbox token is configured, drop a real map here consuming `van`.
 *
 * Theme tokens only; 44px+ targets.
 *
 * _Master Spec: §11.2_
 */
import * as React from 'react';
import Image from 'next/image';
import { MapPin, Navigation, Phone, MessageSquare, PawPrint } from 'lucide-react';

interface TrackerPayload {
  business: string;
  logoUrl: string | null;
  petName: string | null;
  groomerPhone: string | null;
  van: { lat: number; lng: number } | null;
  etaMinutes: number | null;
  ended: boolean;
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

  return (
    <div className="overflow-hidden rounded-box border border-base-content/10 bg-base-100 shadow-card">
      {/* Branded header */}
      <div className="bg-hero px-6 py-7 text-center">
        {data.logoUrl ? (
          <Image
            src={data.logoUrl}
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

            {/* MAP PLACEHOLDER panel (no Mapbox dependency) */}
            <div className="mt-5 rounded-box border border-base-content/10 bg-base-200 p-5">
              <div className="flex items-center gap-2 text-base-content/70">
                <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium">Live location</span>
              </div>
              {data.van ? (
                <p className="mt-2 font-mono text-sm text-base-content/80">
                  {data.van.lat.toFixed(4)}, {data.van.lng.toFixed(4)}
                </p>
              ) : (
                <p className="mt-2 text-sm italic text-base-content/50">
                  Waiting for the van to start sharing…
                </p>
              )}
              <p className="mt-1 text-xs text-base-content/50">
                Location updates automatically every few seconds.
              </p>
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
