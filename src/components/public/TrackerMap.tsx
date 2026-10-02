'use client';

/**
 * TrackerMap — the real interactive map for the public tracker (Master Spec §11.2).
 *
 * A client-only Leaflet map (via react-leaflet) rendering free OpenStreetMap
 * tiles — no API key, no account. Shows a live groomer "van" marker moving
 * toward the client's destination pin, with a dashed route line and an ETA
 * badge. Markers are inline-SVG `divIcon`s (no image-asset path config, which
 * breaks under bundlers), coloured with the DaisyUI theme `primary` token.
 *
 * SSR SAFETY: react-leaflet touches `window`, so this module must only ever be
 * imported by a `next/dynamic(..., { ssr: false })` call — never by a server
 * component. It also guards internally with a `mounted` flag and renders a
 * calm skeleton until the browser paints.
 *
 * _Master Spec: §11.2_
 */
import * as React from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';

type Point = { lat: number; lng: number };

export interface TrackerMapProps {
  van: Point | null;
  destination: Point | null;
  etaLabel: string | null;
  business: string;
}

/** The height the map and its skeleton share, so swaps don't jump the layout. */
const MAP_HEIGHT = 'h-72 sm:h-80';

/**
 * Van marker — an inline SVG van in the theme primary colour, dropped into a
 * Leaflet `divIcon` so no external image asset is needed.
 */
function vanIcon(): L.DivIcon {
  const html = `
    <div class="pp-marker pp-marker--van" role="img" aria-label="Groomer van">
      <span class="pp-marker__pulse"></span>
      <span class="pp-marker__badge">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <path d="M1 3h13v10H1z" />
          <path d="M14 7h4l3 3v3h-7z" />
          <circle cx="5.5" cy="16" r="2" />
          <circle cx="17.5" cy="16" r="2" />
        </svg>
      </span>
    </div>`;
  return L.divIcon({
    html,
    className: 'pp-divicon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -20],
  });
}

/**
 * Destination/home pin — a distinct home-pin SVG `divIcon` for the client's
 * location.
 */
function homeIcon(): L.DivIcon {
  const html = `
    <div class="pp-marker pp-marker--home" role="img" aria-label="Destination">
      <span class="pp-marker__pin">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      </span>
    </div>`;
  return L.divIcon({
    html,
    className: 'pp-divicon',
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    popupAnchor: [0, -40],
  });
}

/**
 * Headless child that reacts to prop changes and keeps the viewport sensible:
 * fit both points when we have them, else pan smoothly to whichever we have.
 */
function MapFocus({ van, destination }: { van: Point | null; destination: Point | null }) {
  const map = useMap();

  React.useEffect(() => {
    if (van && destination) {
      const bounds = L.latLngBounds([
        [van.lat, van.lng],
        [destination.lat, destination.lng],
      ]);
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: true });
    } else if (van) {
      map.flyTo([van.lat, van.lng], 14, { animate: true, duration: 0.6 });
    } else if (destination) {
      map.flyTo([destination.lat, destination.lng], 14, { animate: true, duration: 0.6 });
    }
    // Depend on the primitive coordinates so this reruns only when a point
    // actually moves, not on every new object identity from a poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, van?.lat, van?.lng, destination?.lat, destination?.lng]);

  return null;
}

export function TrackerMap({ van, destination, etaLabel, business }: TrackerMapProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Memoise icons so they aren't rebuilt on every render/poll.
  const vIcon = React.useMemo(() => vanIcon(), []);
  const hIcon = React.useMemo(() => homeIcon(), []);

  // The initial center: prefer the van, then the destination, else a neutral
  // world view (MapFocus will re-fit as soon as real points arrive).
  const center: [number, number] = van
    ? [van.lat, van.lng]
    : destination
      ? [destination.lat, destination.lng]
      : [20, 0];
  const initialZoom = van || destination ? 14 : 2;

  if (!mounted) {
    return (
      <div
        className={`${MAP_HEIGHT} w-full animate-pulse rounded-box border border-base-content/10 bg-base-200`}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className={`${MAP_HEIGHT} relative w-full overflow-hidden rounded-box border border-base-content/10 shadow-card`}
    >
      <MapContainer
        center={center}
        zoom={initialZoom}
        scrollWheelZoom={false}
        zoomControl
        className="h-full w-full"
        style={{ background: 'hsl(var(--b2))' }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        {van && destination && (
          <Polyline
            positions={[
              [van.lat, van.lng],
              [destination.lat, destination.lng],
            ]}
            pathOptions={{
              color: 'hsl(var(--p))',
              weight: 3,
              opacity: 0.7,
              dashArray: '6 8',
            }}
          />
        )}

        {van && (
          <Marker position={[van.lat, van.lng]} icon={vIcon}>
            <Popup>
              <span className="font-medium">{business}</span>
              {etaLabel ? <> — {etaLabel}</> : null}
            </Popup>
          </Marker>
        )}

        {destination && (
          <Marker position={[destination.lat, destination.lng]} icon={hIcon}>
            <Popup>Destination</Popup>
          </Marker>
        )}

        <MapFocus van={van} destination={destination} />
      </MapContainer>

      {/* ETA badge overlay — sits above the map, theme-tokened, AA contrast. */}
      {etaLabel && (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-content shadow-card">
          {etaLabel}
        </div>
      )}
    </div>
  );
}

export default TrackerMap;
